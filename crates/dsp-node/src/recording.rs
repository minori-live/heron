use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
};

use bwavfile::{Bext, WAVE_TAG_FLOAT, WaveFmt, WaveReader, WaveWriter};
use heron_dsp_resample::resample_interleaved;
use napi::{Error, Result, Status, Task, bindgen_prelude::Buffer};
use napi_derive::napi;
use sha2::{Digest, Sha256};

const WAVEFORM_BASE_FRAMES: usize = 64;
const WAVEFORM_LEVEL_FACTOR: usize = 4;

mod finalize;
mod repair;
#[cfg(test)]
mod tests;
mod waveform;
mod waveform_analysis;
mod writer_format;

pub(crate) use waveform_analysis::analyze_waveform_path;
pub(crate) use writer_format::{broadcast_metadata, float_format, recording_error};

pub use repair::{repair_recording_header, write_deterministic_test_recording};
pub use waveform::{
    NativeAnalyzedWaveform, NativeFinalizeRecordingConfig, NativeFinalizedRecording,
    NativeRecordingResult, NativeRecordingStartConfig, NativeWaveformLevel,
};

/// Peak-pyramid size for Criterion. The bench target cannot see `pub(super)` helpers.
#[cfg(feature = "bench-internals")]
#[must_use]
pub fn benchmark_waveform_levels(samples: &[f32], channels: usize) -> usize {
    waveform::build_waveform_levels(samples, channels).len()
}
pub use waveform_analysis::{FinalizeRecordingTask, analyze_waveform, finalize_recording};
