//! Fixture generators shared by the criterion targets in this directory.

use std::{f32::consts::TAU, path::Path};

use bwavfile::{WAVE_TAG_FLOAT, WaveFmt, WaveWriter};

/// Writes a float BWF fixture and returns its size in bytes.
pub fn write_float_fixture(path: &Path, sample_rate: u32, channels: usize, frames: usize) -> u64 {
    let channel_count = u16::try_from(channels).expect("benchmark channel count fits u16");
    let block_alignment = channel_count * 4;
    let format = WaveFmt {
        tag: WAVE_TAG_FLOAT,
        channel_count,
        sample_rate,
        bytes_per_second: sample_rate.saturating_mul(u32::from(block_alignment)),
        block_alignment,
        bits_per_sample: 32,
        extended_format: None,
    };
    let writer = WaveWriter::create(path, format).expect("create benchmark BWF fixture");
    let mut audio = writer
        .audio_frame_writer()
        .expect("start benchmark fixture audio");
    let mut samples = Vec::with_capacity(frames.saturating_mul(channels));
    for frame in 0..frames {
        let phase = frame as f32 / sample_rate as f32 * 440.0 * TAU;
        for channel in 0..channels {
            samples.push(phase.sin() * (0.25 - channel as f32 * 0.002));
        }
    }
    audio
        .write_frames(&samples)
        .expect("write benchmark fixture samples");
    audio.end().expect("finish benchmark fixture");
    std::fs::metadata(path)
        .expect("inspect benchmark fixture")
        .len()
}
