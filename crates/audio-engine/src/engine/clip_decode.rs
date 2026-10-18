use heron_dsp_resample::resample_interleaved;

use super::{
    Arc, ChannelKind, Duration, Ordering, Result, STREAM_WINDOW_SECONDS, StereoFrame,
    StreamControl, StreamTask, StreamWorkerPool, StreamingClip, WaveReader, audio_error,
    invalid_config, mpsc, thread,
};

fn interleaved_to_stereo(samples: &[f32], channels: usize) -> Vec<StereoFrame> {
    samples
        .chunks_exact(channels)
        .map(|frame| {
            let left = frame[0];
            let right = if channels > 1 { frame[1] } else { left };
            [left, right]
        })
        .collect()
}

fn resample_clip_samples(
    samples: &[f32],
    channels: usize,
    source_rate: u32,
    target_rate: u32,
) -> Result<Vec<f32>> {
    resample_interleaved(samples, channels, source_rate, target_rate)
        .map_err(|error| audio_error("failed to resample mixer clip", error))
}

/// Read a mixer clip's on-disk sample rate without decoding PCM.
pub(super) fn inspect_clip_sample_rate(path: &str) -> Result<u32> {
    let mut reader = WaveReader::open(path)
        .map_err(|error| audio_error("failed to inspect mixer clip", error))?;
    let format = reader
        .format()
        .map_err(|error| audio_error("failed to read mixer clip format", error))?;
    if format.sample_rate == 0 {
        return Err(invalid_config("mixer clip has an invalid sample rate"));
    }
    Ok(format.sample_rate)
}

pub fn decode_clip_audio(path: &str, target_sample_rate: u32) -> Result<Vec<StereoFrame>> {
    let mut reader =
        WaveReader::open(path).map_err(|error| audio_error("failed to open mixer clip", error))?;
    let format = reader
        .format()
        .map_err(|error| audio_error("failed to read mixer clip format", error))?;
    let frames = reader
        .frame_length()
        .map_err(|error| audio_error("failed to read mixer clip length", error))?
        as usize;
    let channels = usize::from(format.channel_count);
    if channels == 0 {
        return Err(invalid_config("mixer clip has no audio channels"));
    }
    let mut samples = vec![0.0_f32; frames.saturating_mul(channels)];
    let mut frame_reader = reader
        .audio_frame_reader()
        .map_err(|error| audio_error("failed to open mixer clip audio", error))?;
    let read_frames = frame_reader
        .read_frames(&mut samples)
        .map_err(|error| audio_error("failed to decode mixer clip", error))?
        as usize;
    samples.truncate(read_frames.saturating_mul(channels));
    if samples.is_empty() {
        return Ok(Vec::new());
    }
    let resampled =
        resample_clip_samples(&samples, channels, format.sample_rate, target_sample_rate)?;
    Ok(interleaved_to_stereo(&resampled, channels))
}

/// Prefetch a native-rate mixer clip through the streaming window worker.
///
/// The asset sample rate must already match `target_sample_rate`. Offline
/// Rubber Band conversion is full-file only; rate-mismatched assets must use
/// [`decode_clip_audio`] so adjacent windows do not restart a fresh stretcher.
pub(super) fn spawn_streaming_clip(
    path: String,
    target_sample_rate: u32,
    initial_frame: usize,
) -> Result<(StreamingClip, usize)> {
    let mut metadata_reader = WaveReader::open(&path)
        .map_err(|error| audio_error("failed to inspect streaming mixer clip", error))?;
    let format = metadata_reader
        .format()
        .map_err(|error| audio_error("failed to read streaming clip format", error))?;
    let source_frames = metadata_reader
        .frame_length()
        .map_err(|error| audio_error("failed to read streaming clip length", error))?
        as usize;
    let source_channels = usize::from(format.channel_count);
    if source_channels == 0 || format.sample_rate == 0 {
        return Err(invalid_config("streaming mixer clip has an invalid format"));
    }
    if format.sample_rate != target_sample_rate {
        return Err(invalid_config(
            "streaming mixer clips require a matching sample rate; resample offline first",
        ));
    }
    let capacity = (target_sample_rate as usize)
        .saturating_mul(STREAM_WINDOW_SECONDS)
        .max(1);
    let control = Arc::new(StreamControl::new(capacity, initial_frame));
    let worker_control = Arc::clone(&control);
    let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
    let reader =
        WaveReader::open(&path).map_err(|error| audio_error("clip prefetch failed", error))?;
    let mut frame_reader = reader
        .audio_frame_reader()
        .map_err(|error| audio_error("clip prefetch failed", error))?;
    let prefetch_threshold = (target_sample_rate as usize / 2).max(1);
    let overlap = (target_sample_rate as usize / 4).max(1);
    let mut source_buffer = Vec::<f32>::new();
    let mut ready_sender = Some(ready_sender);
    StreamWorkerPool::global()
        .submit(StreamTask {
            tick: Box::new(move || {
                if worker_control.shutdown.load(Ordering::Acquire) {
                    return false;
                }
                let result = (|| -> std::result::Result<(), String> {
                    let generation = worker_control.generation.load(Ordering::Acquire);
                    let requested = worker_control.requested_frame.load(Ordering::Acquire) as usize;
                    let active = worker_control.active_window.load(Ordering::Acquire);
                    let active_window = &worker_control.windows[active];
                    let active_generation = active_window.generation.load(Ordering::Acquire);
                    let active_start = active_window.start_frame.load(Ordering::Relaxed) as usize;
                    let active_count = active_window.frame_count.load(Ordering::Relaxed);
                    let active_end = active_start.saturating_add(active_count);
                    let covered = active_generation == generation
                        && requested >= active_start
                        && requested < active_end;
                    if covered && active_end.saturating_sub(requested) > prefetch_threshold {
                        return Ok(());
                    }

                    let window_start = if covered {
                        active_end.saturating_sub(overlap)
                    } else {
                        requested
                    };
                    let window_count = capacity.min(source_frames.saturating_sub(window_start));
                    let inactive = 1 - active;
                    while worker_control.reader_window.load(Ordering::Acquire) == inactive + 1
                        && !worker_control.shutdown.load(Ordering::Acquire)
                    {
                        thread::yield_now();
                    }
                    if worker_control.shutdown.load(Ordering::Acquire) {
                        return Ok(());
                    }

                    source_buffer.resize(window_count.saturating_mul(source_channels), 0.0);
                    frame_reader
                        .locate(window_start as u64)
                        .map_err(|error| error.to_string())?;
                    let read_frames = frame_reader
                        .read_frames(&mut source_buffer)
                        .map_err(|error| error.to_string())?
                        as usize;
                    source_buffer.truncate(read_frames.saturating_mul(source_channels));

                    let window = &worker_control.windows[inactive];
                    let mut written = 0;
                    for output_index in 0..window_count {
                        if generation != worker_control.generation.load(Ordering::Acquire) {
                            break;
                        }
                        if output_index >= read_frames {
                            break;
                        }
                        let left = source_buffer[output_index * source_channels];
                        let right = if source_channels > 1 {
                            source_buffer[output_index * source_channels + 1]
                        } else {
                            left
                        };
                        window.store(output_index, [left, right]);
                        written += 1;
                    }
                    if generation != worker_control.generation.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    window
                        .start_frame
                        .store(window_start as u64, Ordering::Relaxed);
                    window.frame_count.store(written, Ordering::Relaxed);
                    window.generation.store(generation, Ordering::Release);
                    worker_control
                        .active_window
                        .store(inactive, Ordering::Release);
                    if let Some(sender) = ready_sender.take() {
                        let _ = sender.send(Ok(()));
                    }
                    Ok(())
                })();
                if let Err(message) = result {
                    worker_control.shutdown.store(true, Ordering::Release);
                    if let Some(sender) = ready_sender.take() {
                        let _ = sender.send(Err(message));
                    }
                    return false;
                }
                true
            }),
        })
        .map_err(|error| audio_error("failed to submit clip prefetch task", error))?;
    match ready_receiver.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(())) => Ok((
            StreamingClip {
                control,
                expected_frame: Some(initial_frame),
            },
            source_frames,
        )),
        Ok(Err(message)) => {
            control.shutdown.store(true, Ordering::Release);
            Err(audio_error("clip prefetch failed", message))
        }
        Err(error) => {
            control.shutdown.store(true, Ordering::Release);
            Err(audio_error("clip prefetch did not become ready", error))
        }
    }
}

pub(super) fn parse_channel_kind(value: &str) -> Result<ChannelKind> {
    match value {
        "audio" => Ok(ChannelKind::Audio),
        "instrument" => Ok(ChannelKind::Instrument),
        "aux" => Ok(ChannelKind::Aux),
        "master" => Ok(ChannelKind::Master),
        "output" => Ok(ChannelKind::Output),
        _ => Err(invalid_config("unknown mixer channel kind")),
    }
}
