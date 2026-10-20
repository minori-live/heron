use super::{
    Arc, AtomicUsize, Duration, Ordering, STREAM_WORKERS, StereoFrame, StreamControl, mpsc, thread,
};

pub(super) struct StreamingClip {
    pub(super) control: Arc<StreamControl>,
    pub(super) expected_frame: Option<usize>,
}

impl StreamingClip {
    /// Read `frame` without treating a retry as a seek (no generation bump).
    #[cfg(test)]
    pub(super) fn poll_sample_at(&mut self, frame: usize) -> Option<StereoFrame> {
        self.expected_frame = Some(frame);
        self.sample_at(frame)
    }

    pub(super) fn sample_at(&mut self, frame: usize) -> Option<StereoFrame> {
        if self.expected_frame != Some(frame) {
            self.control.generation.fetch_add(1, Ordering::AcqRel);
        }
        self.expected_frame = frame.checked_add(1);
        self.control
            .requested_frame
            .store(frame as u64, Ordering::Release);

        for _ in 0..2 {
            let active = self.control.active_window.load(Ordering::Acquire);
            self.control
                .reader_window
                .store(active + 1, Ordering::Release);
            if active != self.control.active_window.load(Ordering::Acquire) {
                self.control.reader_window.store(0, Ordering::Release);
                continue;
            }
            let window = &self.control.windows[active];
            let generation = window.generation.load(Ordering::Acquire);
            let start = window.start_frame.load(Ordering::Relaxed) as usize;
            let count = window.frame_count.load(Ordering::Relaxed);
            let sample = (generation == self.control.generation.load(Ordering::Acquire)
                && frame >= start
                && frame < start.saturating_add(count))
            .then(|| window.load(frame - start));
            self.control.reader_window.store(0, Ordering::Release);
            return sample;
        }
        None
    }

    /// Mix `dest.len()` source frames starting at `source_frame`.
    ///
    /// The reader pins the active window and copies every frame that window
    /// still covers, then releases the pin. A later frame takes a second pin so
    /// a window swap in the middle of the block stays visible. `requested_frame`
    /// ends on the last frame of the range, which is the prefetch cursor a
    /// per-sample walk would leave behind.
    fn mix_range(
        &mut self,
        source_frame: usize,
        relative: usize,
        fade_in: usize,
        fade_out: usize,
        length: usize,
        dest: &mut [StereoFrame],
    ) -> bool {
        let count = dest.len();
        if count == 0 {
            return false;
        }
        let Some(end_frame) = source_frame.checked_add(count) else {
            return true;
        };
        if self.expected_frame != Some(source_frame) {
            self.control.generation.fetch_add(1, Ordering::AcqRel);
        }
        self.control
            .requested_frame
            .store(source_frame as u64, Ordering::Release);

        let mut consumed = 0usize;
        let mut underrun = false;
        while consumed < count {
            let frame = source_frame + consumed;
            let Some(active) = self.pin_matching_window() else {
                underrun = true;
                consumed += 1;
                continue;
            };
            let window = &self.control.windows[active];
            let start = window.start_frame.load(Ordering::Relaxed) as usize;
            let window_count = window.frame_count.load(Ordering::Relaxed);
            let window_end = start.saturating_add(window_count);
            if frame < start || frame >= window_end {
                self.control.reader_window.store(0, Ordering::Release);
                underrun = true;
                consumed += 1;
                continue;
            }
            let run = (window_end - frame).min(count - consumed);
            if fade_in == 0 && fade_out == 0 {
                for index in 0..run {
                    let sample = window.load(frame + index - start);
                    let out = &mut dest[consumed + index];
                    out[0] += sample[0];
                    out[1] += sample[1];
                }
            } else {
                for index in 0..run {
                    let sample = window.load(frame + index - start);
                    accumulate_with_gain(
                        &mut dest[consumed + index],
                        sample,
                        relative + consumed + index,
                        fade_in,
                        fade_out,
                        length,
                    );
                }
            }
            self.control.reader_window.store(0, Ordering::Release);
            consumed += run;
        }

        self.expected_frame = Some(end_frame);
        self.control
            .requested_frame
            .store(end_frame as u64 - 1, Ordering::Release);
        underrun
    }

    /// Pin the active window when its generation matches the reader's.
    ///
    /// The pin stays held on `Some`. The caller copies out of that window, then
    /// stores `reader_window` back to zero.
    fn pin_matching_window(&self) -> Option<usize> {
        for _ in 0..2 {
            let active = self.control.active_window.load(Ordering::Acquire);
            self.control
                .reader_window
                .store(active + 1, Ordering::Release);
            if active != self.control.active_window.load(Ordering::Acquire) {
                self.control.reader_window.store(0, Ordering::Release);
                continue;
            }
            let generation = self.control.windows[active]
                .generation
                .load(Ordering::Acquire);
            if generation == self.control.generation.load(Ordering::Acquire) {
                return Some(active);
            }
            self.control.reader_window.store(0, Ordering::Release);
            return None;
        }
        None
    }
}

impl Drop for StreamingClip {
    fn drop(&mut self) {
        self.control.shutdown.store(true, Ordering::Release);
    }
}

pub(super) struct StreamTask {
    pub(super) tick: Box<dyn FnMut() -> bool + Send>,
}

pub(super) struct StreamWorkerPool {
    pub(super) lanes: Vec<mpsc::SyncSender<StreamTask>>,
    pub(super) next_lane: AtomicUsize,
}

impl StreamWorkerPool {
    pub(super) fn global() -> &'static Self {
        STREAM_WORKERS.get_or_init(|| {
            let lane_count = thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(2)
                .clamp(2, 4);
            let mut lanes = Vec::with_capacity(lane_count);
            for lane in 0..lane_count {
                let (sender, receiver) = mpsc::sync_channel::<StreamTask>(128);
                thread::Builder::new()
                    .name(format!("heron-background-io-{lane}"))
                    .spawn(move || stream_worker_lane(receiver))
                    .expect("background I/O worker must start");
                lanes.push(sender);
            }
            Self {
                lanes,
                next_lane: AtomicUsize::new(0),
            }
        })
    }

    pub(super) fn submit(&self, task: StreamTask) -> std::result::Result<(), String> {
        let lane = self.next_lane.fetch_add(1, Ordering::Relaxed) % self.lanes.len();
        self.lanes[lane]
            .send(task)
            .map_err(|error| error.to_string())
    }
}

fn stream_worker_lane(receiver: mpsc::Receiver<StreamTask>) {
    let mut tasks = Vec::<StreamTask>::new();
    loop {
        if tasks.is_empty() {
            match receiver.recv() {
                Ok(task) => tasks.push(task),
                Err(_) => return,
            }
        }
        while let Ok(task) = receiver.try_recv() {
            tasks.push(task);
        }
        tasks.retain_mut(|task| (task.tick)());
        thread::sleep(Duration::from_millis(2));
    }
}

pub(super) enum ClipSamples {
    Memory(Vec<StereoFrame>),
    Streaming(StreamingClip),
}

pub(super) struct LoadedClip {
    pub(super) channel_index: usize,
    pub(super) start_frame: u64,
    pub(super) source_offset_frames: usize,
    pub(super) length_frames: usize,
    pub(super) fade_in_frames: usize,
    pub(super) fade_out_frames: usize,
    pub(super) samples: ClipSamples,
}

impl LoadedClip {
    #[cfg(test)]
    pub(super) fn gain_at(&self, relative: usize) -> f32 {
        clip_gain(
            self.fade_in_frames,
            self.fade_out_frames,
            self.length_frames,
            relative,
        )
    }

    /// Add the clip's overlap with `[position, position + frame_count)` into the
    /// channel-major block. Streaming misses report an underrun. A memory read
    /// past the end of the buffer stays silent.
    pub(super) fn mix_into(
        &mut self,
        position: u64,
        frame_count: usize,
        channel_sources: &mut [StereoFrame],
    ) -> bool {
        if frame_count == 0 {
            return false;
        }
        let block_end = position.saturating_add(frame_count as u64);
        let clip_end = self.start_frame.saturating_add(self.length_frames as u64);
        let overlap_start = position.max(self.start_frame);
        let overlap_end = block_end.min(clip_end);
        if overlap_start >= overlap_end {
            return false;
        }
        let dest_offset = (overlap_start - position) as usize;
        let relative = (overlap_start - self.start_frame) as usize;
        let count = (overlap_end - overlap_start) as usize;
        let base = self
            .channel_index
            .saturating_mul(frame_count)
            .saturating_add(dest_offset);
        let Some(end) = base
            .checked_add(count)
            .filter(|end| *end <= channel_sources.len())
        else {
            return false;
        };
        let dest = &mut channel_sources[base..end];
        let fade_in = self.fade_in_frames;
        let fade_out = self.fade_out_frames;
        let length = self.length_frames;
        let source_offset = self.source_offset_frames;
        match &mut self.samples {
            ClipSamples::Memory(samples) => {
                mix_memory(
                    samples,
                    source_offset,
                    relative,
                    fade_in,
                    fade_out,
                    length,
                    dest,
                );
                false
            }
            ClipSamples::Streaming(stream) => {
                let Some(source_frame) = source_offset.checked_add(relative) else {
                    return true;
                };
                stream.mix_range(source_frame, relative, fade_in, fade_out, length, dest)
            }
        }
    }
}

fn clip_gain(
    fade_in_frames: usize,
    fade_out_frames: usize,
    length_frames: usize,
    relative: usize,
) -> f32 {
    let fade_in = if fade_in_frames == 0 || relative >= fade_in_frames {
        1.0
    } else {
        ((relative as f32) / (fade_in_frames as f32)).sqrt()
    };
    let remaining = length_frames.saturating_sub(relative);
    let fade_out = if fade_out_frames == 0 || remaining > fade_out_frames {
        1.0
    } else {
        ((remaining as f32) / (fade_out_frames as f32)).sqrt()
    };
    fade_in * fade_out
}

fn mix_memory(
    samples: &[StereoFrame],
    source_offset: usize,
    relative: usize,
    fade_in: usize,
    fade_out: usize,
    length: usize,
    dest: &mut [StereoFrame],
) {
    let Some(source_start) = source_offset.checked_add(relative) else {
        return;
    };
    let available = samples.len().saturating_sub(source_start).min(dest.len());
    if available == 0 {
        return;
    }
    let src = &samples[source_start..source_start + available];
    let dest = &mut dest[..available];
    if fade_in == 0 && fade_out == 0 {
        for (out, sample) in dest.iter_mut().zip(src) {
            out[0] += sample[0];
            out[1] += sample[1];
        }
        return;
    }
    for (index, (out, sample)) in dest.iter_mut().zip(src).enumerate() {
        accumulate_with_gain(out, *sample, relative + index, fade_in, fade_out, length);
    }
}

fn accumulate_with_gain(
    dest: &mut StereoFrame,
    sample: StereoFrame,
    relative: usize,
    fade_in: usize,
    fade_out: usize,
    length: usize,
) {
    let unity_end = length.saturating_sub(fade_out);
    if relative >= fade_in && relative < unity_end {
        dest[0] += sample[0];
        dest[1] += sample[1];
    } else {
        let gain = clip_gain(fade_in, fade_out, length, relative);
        dest[0] += sample[0] * gain;
        dest[1] += sample[1] * gain;
    }
}
