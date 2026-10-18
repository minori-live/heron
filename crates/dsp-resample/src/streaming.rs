//! Persistent Rubber Band stretcher for streaming sample-rate conversion.
//!
//! Real-time mode keeps one stretcher alive across contiguous source chunks so
//! prefetch windows stay phase-continuous. Seeks reset and re-prime with
//! [`getPreferredStartPad`] / [`getStartDelay`] so output stays sample-aligned.

use std::ptr;

use heron_rubberband_sys as ffi;

use crate::{PROCESS_CHUNK_FRAMES, ResampleError, deinterleave, expected_output_frames};

const PROCESS_REALTIME: i32 = 0x0000_0001;
const ENGINE_FINER: i32 = 0x2000_0000;
const PITCH_HIGH_QUALITY: i32 = 0x0200_0000;
const CHANNELS_TOGETHER: i32 = 0x1000_0000;
const THREADING_NEVER: i32 = 0x0001_0000;

const STREAMING_OPTIONS: i32 =
    PROCESS_REALTIME | ENGINE_FINER | PITCH_HIGH_QUALITY | CHANNELS_TOGETHER | THREADING_NEVER;

/// Map an output-frame index to the corresponding source-frame index.
#[must_use]
pub fn source_frame_for_output(output_frame: usize, source_rate: u32, target_rate: u32) -> usize {
    if target_rate == 0 {
        return 0;
    }
    ((output_frame as u128 * u128::from(source_rate)) / u128::from(target_rate)) as usize
}

/// Rubber Band R3 real-time stretcher that survives across streaming windows.
pub struct StreamingSrc {
    state: ffi::RubberBandState,
    channels: usize,
    source_rate: u32,
    target_rate: u32,
    start_pad: usize,
    start_delay: usize,
    delay_remaining: usize,
    next_output_frame: usize,
    next_source_frame: usize,
    output_fifo: Vec<f32>,
    planar_scratch: Vec<Vec<f32>>,
}

impl StreamingSrc {
    /// Create a streaming SRC stretcher. Rates must differ and be positive.
    ///
    /// # Errors
    ///
    /// Returns [`ResampleError`] when rates/channels are invalid or construction fails.
    pub fn new(channels: usize, source_rate: u32, target_rate: u32) -> Result<Self, ResampleError> {
        if source_rate == 0 || target_rate == 0 {
            return Err(ResampleError::InvalidSampleRate);
        }
        if channels == 0 {
            return Err(ResampleError::InvalidChannelCount);
        }
        if source_rate == target_rate {
            return Err(ResampleError::InvalidSampleRate);
        }
        let time_ratio = f64::from(target_rate) / f64::from(source_rate);
        let pitch_scale = f64::from(source_rate) / f64::from(target_rate);
        // SAFETY: Options are a bitwise OR of documented Rubber Band flags.
        let state = unsafe {
            ffi::rubberband_new(
                source_rate,
                channels as u32,
                STREAMING_OPTIONS,
                time_ratio,
                pitch_scale,
            )
        };
        if state.is_null() {
            return Err(ResampleError::StretcherCreateFailed);
        }
        // SAFETY: state is a live Rubber Band instance owned by this struct.
        let (start_pad, start_delay) = unsafe {
            ffi::rubberband_set_max_process_size(state, PROCESS_CHUNK_FRAMES as u32);
            (
                ffi::rubberband_get_preferred_start_pad(state) as usize,
                ffi::rubberband_get_start_delay(state) as usize,
            )
        };
        let mut streaming = Self {
            state,
            channels,
            source_rate,
            target_rate,
            start_pad,
            start_delay,
            delay_remaining: 0,
            next_output_frame: 0,
            next_source_frame: 0,
            output_fifo: Vec::new(),
            planar_scratch: vec![Vec::new(); channels],
        };
        streaming.prime_at_output(0)?;
        Ok(streaming)
    }

    /// Total output frames for a source of `source_frames` (matches offline rounding).
    #[must_use]
    pub fn target_frames(&self, source_frames: usize) -> usize {
        expected_output_frames(source_frames, self.source_rate, self.target_rate)
    }

    /// Next absolute output frame this stretcher will produce.
    #[must_use]
    pub fn next_output_frame(&self) -> usize {
        self.next_output_frame
    }

    /// Next source frame that should be read from the file.
    #[must_use]
    pub fn next_source_frame(&self) -> usize {
        self.next_source_frame
    }

    /// Preferred silence pad length for real-time start alignment.
    #[must_use]
    pub fn preferred_start_pad(&self) -> usize {
        self.start_pad
    }

    /// Output frames discarded after pad before samples are time-aligned.
    #[must_use]
    pub fn start_delay(&self) -> usize {
        self.start_delay
    }

    /// Reset and re-prime so the next retrieved frame is `output_frame`.
    ///
    /// Feeds Rubber Band's preferred start pad (silence) and discards
    /// [`Self::start_delay`] output frames so the first retrieved sample is
    /// time-aligned with `source_frame_for_output(output_frame, ...)`.
    /// Returns that source frame index for the caller to resume reading.
    ///
    /// # Errors
    ///
    /// Returns [`ResampleError`] when pad processing fails.
    pub fn seek_output(&mut self, output_frame: usize) -> Result<usize, ResampleError> {
        self.prime_at_output(output_frame)?;
        Ok(self.next_source_frame)
    }

    /// Feed interleaved source PCM and pull any newly available output frames.
    ///
    /// # Errors
    ///
    /// Returns [`ResampleError`] when the buffer length is invalid.
    pub fn process_interleaved(
        &mut self,
        interleaved: &[f32],
        is_final: bool,
    ) -> Result<(), ResampleError> {
        if interleaved.is_empty() {
            if is_final {
                self.process_planar_chunk(&[], 0, 0, true);
                self.drain_available();
            }
            return Ok(());
        }
        if !interleaved.len().is_multiple_of(self.channels) {
            return Err(ResampleError::InvalidBufferLength);
        }
        let frames = interleaved.len() / self.channels;
        let planar = deinterleave(interleaved, self.channels);
        let mut offset = 0usize;
        while offset < frames {
            let end = (offset + PROCESS_CHUNK_FRAMES).min(frames);
            let final_block = is_final && end == frames;
            self.process_planar_chunk(&planar, offset, end - offset, final_block);
            offset = end;
            self.drain_available();
        }
        self.next_source_frame = self.next_source_frame.saturating_add(frames);
        Ok(())
    }

    /// Number of output frames waiting in the FIFO (post start-delay trim).
    #[must_use]
    pub fn available_frames(&self) -> usize {
        self.output_fifo.len() / self.channels
    }

    /// Copy up to `max_frames` interleaved output frames into `out`, removing them from the FIFO.
    pub fn retrieve_interleaved(&mut self, out: &mut Vec<f32>, max_frames: usize) -> usize {
        let take = max_frames.min(self.available_frames());
        let samples = take.saturating_mul(self.channels);
        out.extend_from_slice(&self.output_fifo[..samples]);
        self.output_fifo.drain(..samples);
        self.next_output_frame = self.next_output_frame.saturating_add(take);
        take
    }

    /// Drain all available interleaved output into `out`.
    pub fn retrieve_all_interleaved(&mut self, out: &mut Vec<f32>) -> usize {
        let available = self.available_frames();
        self.retrieve_interleaved(out, available)
    }

    fn prime_at_output(&mut self, output_frame: usize) -> Result<(), ResampleError> {
        // SAFETY: state is owned by this instance for its lifetime.
        unsafe { ffi::rubberband_reset(self.state) };
        self.output_fifo.clear();
        self.delay_remaining = self.start_delay;
        self.next_output_frame = output_frame;
        self.next_source_frame =
            source_frame_for_output(output_frame, self.source_rate, self.target_rate);
        if self.start_pad > 0 {
            let silence = vec![0.0_f32; self.start_pad.saturating_mul(self.channels)];
            let planar = deinterleave(&silence, self.channels);
            let mut offset = 0usize;
            while offset < self.start_pad {
                let end = (offset + PROCESS_CHUNK_FRAMES).min(self.start_pad);
                self.process_planar_chunk(&planar, offset, end - offset, false);
                offset = end;
                self.drain_available();
            }
        }
        Ok(())
    }

    fn process_planar_chunk(
        &mut self,
        planar: &[Vec<f32>],
        start: usize,
        frames: usize,
        is_final: bool,
    ) {
        if frames == 0 && !is_final {
            return;
        }
        if frames == 0 {
            let nulls = vec![ptr::null(); self.channels];
            // SAFETY: final empty process is allowed by Rubber Band.
            unsafe {
                ffi::rubberband_process(self.state, nulls.as_ptr(), 0, 1);
            }
            return;
        }
        let pointers: Vec<*const f32> = planar
            .iter()
            .map(|channel| channel[start..start + frames].as_ptr())
            .collect();
        // SAFETY: pointers reference disjoint planar slices for `frames`.
        unsafe {
            ffi::rubberband_process(
                self.state,
                pointers.as_ptr(),
                frames as u32,
                i32::from(is_final),
            );
        }
    }

    fn drain_available(&mut self) {
        loop {
            // SAFETY: state is live for the duration of this instance.
            let available = unsafe { ffi::rubberband_available(self.state) };
            if available <= 0 {
                break;
            }
            let take = (available as usize).min(8_192);
            for channel in &mut self.planar_scratch {
                channel.resize(take, 0.0);
            }
            let pointers: Vec<*mut f32> = self
                .planar_scratch
                .iter_mut()
                .map(|channel| channel.as_mut_ptr())
                .collect();
            // SAFETY: each channel buffer has `take` writable frames.
            let retrieved =
                unsafe { ffi::rubberband_retrieve(self.state, pointers.as_ptr(), take as u32) }
                    as usize;
            let mut frame = 0usize;
            while frame < retrieved {
                if self.delay_remaining > 0 {
                    self.delay_remaining -= 1;
                    frame += 1;
                    continue;
                }
                for channel in 0..self.channels {
                    self.output_fifo.push(self.planar_scratch[channel][frame]);
                }
                frame += 1;
            }
        }
    }
}

impl Drop for StreamingSrc {
    fn drop(&mut self) {
        if !self.state.is_null() {
            // SAFETY: state was created by rubberband_new and not yet deleted.
            unsafe { ffi::rubberband_delete(self.state) };
            self.state = ptr::null_mut();
        }
    }
}

// Rubber Band state must not be shared across threads.
unsafe impl Send for StreamingSrc {}

#[cfg(test)]
mod tests {
    use std::f32::consts::TAU;

    use crate::resample_interleaved;

    use super::{StreamingSrc, source_frame_for_output};

    fn sine(frames: usize, sample_rate: u32, frequency: f32, channels: usize) -> Vec<f32> {
        let mut samples = Vec::with_capacity(frames * channels);
        for frame in 0..frames {
            let value = (TAU * frequency * frame as f32 / sample_rate as f32).sin() * 0.5;
            for _ in 0..channels {
                samples.push(value);
            }
        }
        samples
    }

    fn stream_persistent(
        input: &[f32],
        channels: usize,
        source_rate: u32,
        target_rate: u32,
        source_chunk: usize,
    ) -> Vec<f32> {
        let source_frames = input.len() / channels;
        let mut streaming = StreamingSrc::new(channels, source_rate, target_rate).expect("create");
        let target_frames = streaming.target_frames(source_frames);
        let mut output = Vec::with_capacity(target_frames * channels);
        let mut offset = 0usize;
        while offset < source_frames {
            let end = (offset + source_chunk).min(source_frames);
            let chunk = &input[offset * channels..end * channels];
            let is_final = end == source_frames;
            streaming
                .process_interleaved(chunk, is_final)
                .expect("process");
            streaming.retrieve_all_interleaved(&mut output);
            offset = end;
        }
        streaming.retrieve_all_interleaved(&mut output);
        output.truncate(target_frames * channels);
        while output.len() < target_frames * channels {
            output.push(0.0);
        }
        output
    }

    /// Old Bugbot failure mode: fresh stretcher per source chunk.
    fn stream_fresh_each_chunk(
        input: &[f32],
        channels: usize,
        source_rate: u32,
        target_rate: u32,
        source_chunk: usize,
    ) -> Vec<f32> {
        let source_frames = input.len() / channels;
        let target_frames = crate::expected_output_frames(source_frames, source_rate, target_rate);
        let mut output = Vec::with_capacity(target_frames * channels);
        let mut offset = 0usize;
        while offset < source_frames {
            let end = (offset + source_chunk).min(source_frames);
            let chunk = &input[offset * channels..end * channels];
            let mut streaming =
                StreamingSrc::new(channels, source_rate, target_rate).expect("create");
            streaming.process_interleaved(chunk, true).expect("process");
            streaming.retrieve_all_interleaved(&mut output);
            offset = end;
        }
        output.truncate(target_frames * channels);
        while output.len() < target_frames * channels {
            output.push(0.0);
        }
        output
    }

    fn max_boundary_step(samples: &[f32], boundaries: &[usize]) -> f32 {
        let mut max_step = 0.0_f32;
        for &boundary in boundaries {
            if boundary == 0 || boundary >= samples.len() {
                continue;
            }
            max_step = max_step.max((samples[boundary] - samples[boundary - 1]).abs());
        }
        max_step
    }

    #[test]
    fn source_frame_mapping_is_monotonic() {
        assert_eq!(source_frame_for_output(0, 44_100, 48_000), 0);
        assert!(source_frame_for_output(480, 44_100, 48_000) < 480);
        assert_eq!(source_frame_for_output(48_000, 44_100, 48_000), 44_100);
    }

    #[test]
    fn streaming_windows_match_single_pass_without_boundary_clicks() {
        let source_rate = 22_050;
        let target_rate = 48_000;
        let channels = 1;
        let chunk = 2_048usize;
        let input = sine(source_rate as usize / 2, source_rate, 440.0, channels);
        let offline =
            resample_interleaved(&input, channels, source_rate, target_rate).expect("offline");
        let streamed = stream_persistent(&input, channels, source_rate, target_rate, chunk);
        let fresh = stream_fresh_each_chunk(&input, channels, source_rate, target_rate, chunk);
        assert_eq!(streamed.len(), offline.len());

        // Persistent streaming stays close to the offline single-pass reference.
        let mut max_err = 0.0_f32;
        let mut mean_err = 0.0_f64;
        for (a, b) in streamed.iter().zip(offline.iter()) {
            let err = (a - b).abs();
            max_err = max_err.max(err);
            mean_err += f64::from(err);
        }
        mean_err /= streamed.len().max(1) as f64;
        assert!(
            mean_err < 0.03,
            "persistent vs offline mean abs error {mean_err}"
        );
        assert!(
            max_err < 0.15,
            "persistent vs offline max abs error {max_err}"
        );

        let ratio = f64::from(target_rate) / f64::from(source_rate);
        let boundaries: Vec<usize> = [chunk, chunk * 2, chunk * 3]
            .into_iter()
            .map(|source_at| ((source_at as f64) * ratio).round() as usize)
            .filter(|&b| b > 0 && b < streamed.len())
            .collect();
        let persistent_step = max_boundary_step(&streamed, &boundaries);
        let offline_step = max_boundary_step(&offline, &boundaries);
        let fresh_step = max_boundary_step(&fresh, &boundaries);
        assert!(
            (persistent_step - offline_step).abs() < 0.04,
            "persistent boundary step {persistent_step} vs offline {offline_step}"
        );
        assert!(
            fresh_step > persistent_step * 2.0 + 0.02,
            "fresh-per-window should click harder: fresh={fresh_step} persistent={persistent_step}"
        );
    }

    fn stream_from_seek(
        input: &[f32],
        channels: usize,
        source_rate: u32,
        target_rate: u32,
        seek_at: usize,
        out_frames: usize,
    ) -> Vec<f32> {
        let source_frames = input.len() / channels;
        let mut streaming = StreamingSrc::new(channels, source_rate, target_rate).expect("create");
        let source_start = streaming.seek_output(seek_at).expect("seek");
        assert_eq!(
            source_start,
            source_frame_for_output(seek_at, source_rate, target_rate)
        );
        let mut output = Vec::new();
        let mut offset = source_start;
        while offset < source_frames && output.len() / channels < out_frames {
            let end = (offset + 1_024).min(source_frames);
            streaming
                .process_interleaved(
                    &input[offset * channels..end * channels],
                    end == source_frames,
                )
                .expect("process");
            streaming.retrieve_all_interleaved(&mut output);
            offset = end;
        }
        output.truncate(out_frames * channels);
        output
    }

    #[test]
    fn streaming_seek_is_aligned_and_deterministic() {
        let source_rate = 22_050;
        let target_rate = 48_000;
        let channels = 1;
        let input = sine(source_rate as usize, source_rate, 440.0, channels);
        let continuous = stream_persistent(&input, channels, source_rate, target_rate, 2_048);
        let seek_at = continuous.len() / 3;
        let first = stream_from_seek(&input, channels, source_rate, target_rate, seek_at, 2_048);
        let second = stream_from_seek(&input, channels, source_rate, target_rate, seek_at, 2_048);
        assert_eq!(first, second, "seek re-prime must be deterministic");

        // Best lag vs the continuous stream should be near zero: pad/delay
        // compensation keeps the seek point sample-accurate.
        let probe = 1_024
            .min(first.len())
            .min(continuous.len().saturating_sub(seek_at));
        let mut best_lag = 0isize;
        let mut best_score = f64::MIN;
        for lag in -64isize..=64 {
            let mut score = 0.0_f64;
            let mut count = 0usize;
            for i in 0..probe {
                let ci = seek_at as isize + i as isize + lag;
                if ci < 0 || ci as usize >= continuous.len() {
                    continue;
                }
                score += f64::from(first[i] * continuous[ci as usize]);
                count += 1;
            }
            if count > 0 {
                score /= count as f64;
            }
            if score > best_score {
                best_score = score;
                best_lag = lag;
            }
        }
        assert!(
            best_lag.abs() <= 8,
            "seek alignment lag {best_lag} (score={best_score})"
        );
        assert!(
            best_score > 0.05,
            "seek segment should correlate with continuous audio (score={best_score})"
        );
    }
}
