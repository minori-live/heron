use std::io::{Read, Seek};

use bwavfile::AudioFrameReader;
use heron_dsp_resample::{
    StreamingSrc, expected_output_frames, resample_interleaved, source_frame_for_output,
};

use super::{
    Arc, ChannelKind, Duration, Ordering, Result, STREAM_WINDOW_SECONDS, StereoFrame,
    StreamControl, StreamTask, StreamWorkerPool, StreamingClip, WaveReader, audio_error,
    invalid_config, mpsc, thread,
};

struct SeekPrimeContext<'a, R: Read + Seek> {
    src: &'a mut StreamingSrc,
    frame_reader: &'a mut AudioFrameReader<R>,
    preroll_buffer: &'a mut Vec<f32>,
    source_channels: usize,
    source_frames: usize,
    source_rate: u32,
    target_rate: u32,
}

/// Reset the stretcher at `output_frame`, warm it with source pre-roll ending
/// at the seek point, and discard warm-up output so playback starts clean.
fn prime_streaming_seek<R: Read + Seek>(
    ctx: &mut SeekPrimeContext<'_, R>,
    output_frame: usize,
) -> std::result::Result<(), String> {
    let seek_source = source_frame_for_output(output_frame, ctx.source_rate, ctx.target_rate)
        .min(ctx.source_frames);
    let preroll_frames = ctx.src.suggested_preroll_frames(seek_source);
    let preroll_start = seek_source.saturating_sub(preroll_frames);
    ctx.preroll_buffer.clear();
    if preroll_frames > 0 {
        ctx.preroll_buffer
            .resize(preroll_frames.saturating_mul(ctx.source_channels), 0.0);
        ctx.frame_reader
            .locate(preroll_start as u64)
            .map_err(|error| error.to_string())?;
        let read = ctx
            .frame_reader
            .read_frames(ctx.preroll_buffer)
            .map_err(|error| error.to_string())? as usize;
        ctx.preroll_buffer
            .truncate(read.saturating_mul(ctx.source_channels));
    }
    ctx.src
        .seek_output(output_frame, ctx.preroll_buffer)
        .map_err(|error| error.to_string())?;
    Ok(())
}

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

/// Prefetch a mixer clip through the streaming window worker.
///
/// When the asset rate matches `target_sample_rate`, windows copy PCM directly.
/// When rates differ, one persistent Rubber Band [`StreamingSrc`] is fed
/// contiguous source across windows (seek resets and re-primes with start pad /
/// delay). Work stays on the background I/O worker, not the audio callback.
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
    let target_frames = if format.sample_rate == target_sample_rate {
        source_frames
    } else {
        expected_output_frames(source_frames, format.sample_rate, target_sample_rate)
    };
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
    let needs_src = format.sample_rate != target_sample_rate;
    let mut streaming_src = if needs_src {
        Some(
            StreamingSrc::new(source_channels, format.sample_rate, target_sample_rate)
                .map_err(|error| audio_error("failed to create streaming resampler", error))?,
        )
    } else {
        None
    };
    let mut source_buffer = Vec::<f32>::new();
    let mut output_buffer = Vec::<f32>::new();
    let mut preroll_buffer = Vec::<f32>::new();
    if let Some(src) = streaming_src.as_mut()
        && initial_frame != 0
    {
        prime_streaming_seek(
            &mut SeekPrimeContext {
                src,
                frame_reader: &mut frame_reader,
                preroll_buffer: &mut preroll_buffer,
                source_channels,
                source_frames,
                source_rate: format.sample_rate,
                target_rate: target_sample_rate,
            },
            initial_frame,
        )
        .map_err(|error| audio_error("failed to prime streaming resampler", error))?;
    }
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

                    // SRC must not rewind into already-produced output; skip the
                    // native-rate overlap refill and continue from active_end.
                    let window_start = if covered {
                        if needs_src {
                            active_end
                        } else {
                            active_end.saturating_sub(overlap)
                        }
                    } else {
                        requested
                    };
                    let window_count = capacity.min(target_frames.saturating_sub(window_start));
                    if window_count == 0 {
                        return Ok(());
                    }
                    let inactive = 1 - active;
                    while worker_control.reader_window.load(Ordering::Acquire) == inactive + 1
                        && !worker_control.shutdown.load(Ordering::Acquire)
                    {
                        thread::yield_now();
                    }
                    if worker_control.shutdown.load(Ordering::Acquire) {
                        return Ok(());
                    }

                    let window = &worker_control.windows[inactive];
                    let mut written = 0usize;
                    if let Some(src) = streaming_src.as_mut() {
                        if window_start != src.next_output_frame() {
                            prime_streaming_seek(
                                &mut SeekPrimeContext {
                                    src,
                                    frame_reader: &mut frame_reader,
                                    preroll_buffer: &mut preroll_buffer,
                                    source_channels,
                                    source_frames,
                                    source_rate: format.sample_rate,
                                    target_rate: target_sample_rate,
                                },
                                window_start,
                            )?;
                        }
                        let mut reached_end = src.input_finalized();
                        while src.available_frames() < window_count && !reached_end {
                            if generation != worker_control.generation.load(Ordering::Acquire) {
                                break;
                            }
                            let source_pos = src.next_source_frame();
                            if source_pos >= source_frames {
                                // Finalize at most once; later windows only drain.
                                if !src.input_finalized() {
                                    src.process_interleaved(&[], true)
                                        .map_err(|error| error.to_string())?;
                                }
                                reached_end = true;
                                continue;
                            }
                            let want = 2_048.min(source_frames.saturating_sub(source_pos));
                            source_buffer.resize(want.saturating_mul(source_channels), 0.0);
                            frame_reader
                                .locate(source_pos as u64)
                                .map_err(|error| error.to_string())?;
                            let read_frames = frame_reader
                                .read_frames(&mut source_buffer)
                                .map_err(|error| error.to_string())?
                                as usize;
                            source_buffer.truncate(read_frames.saturating_mul(source_channels));
                            let is_final = source_pos.saturating_add(read_frames) >= source_frames;
                            src.process_interleaved(&source_buffer, is_final)
                                .map_err(|error| error.to_string())?;
                            if read_frames == 0 || is_final || src.input_finalized() {
                                reached_end = true;
                            }
                        }
                        output_buffer.clear();
                        src.retrieve_interleaved(&mut output_buffer, window_count);
                        let stereo = interleaved_to_stereo(&output_buffer, source_channels);
                        for output_index in 0..window_count {
                            if generation != worker_control.generation.load(Ordering::Acquire) {
                                break;
                            }
                            if output_index >= stereo.len() {
                                break;
                            }
                            window.store(output_index, stereo[output_index]);
                            written += 1;
                        }
                    } else {
                        source_buffer.resize(window_count.saturating_mul(source_channels), 0.0);
                        frame_reader
                            .locate(window_start as u64)
                            .map_err(|error| error.to_string())?;
                        let read_frames = frame_reader
                            .read_frames(&mut source_buffer)
                            .map_err(|error| error.to_string())?
                            as usize;
                        source_buffer.truncate(read_frames.saturating_mul(source_channels));
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
            target_frames,
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
