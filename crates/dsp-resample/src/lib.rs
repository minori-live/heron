//! Sample-rate conversion for Heron media loads, recording finalize, and
//! streaming clip prefetch.
//!
//! # Rubber Band choice
//!
//! Heron builds Rubber Band Library v4 from the sources vendored in
//! `heron-rubberband-sys` (no system package). Offline conversion uses the R3
//! (`RubberBandOptionEngineFiner`) stretcher rather than Rubber Band's internal
//! C++ `Resampler` class: the C stretcher API is what we wrap safely here, and
//! the same type is the natural extension point for later time-stretch /
//! pitch-shift features.
//!
//! Sample-rate conversion sets:
//!
//! - `time_ratio = target_rate / source_rate` so output frame count matches the
//!   new rate for the same wall-clock duration
//! - `pitch_scale = source_rate / target_rate` so a tone keeps its frequency
//!   when the output is played at `target_rate`
//!
//! A time ratio of `1.0` alone would keep the frame count and therefore change
//! duration once the buffer is labeled at the new rate; both ratios are
//! required for correct SRC. Streaming prefetch uses [`StreamingSrc`] (one
//! persistent real-time stretcher per clip). Real-time device clock adaptation
//! continues to use `rubato` in the audio engine.

use std::ptr;

use heron_rubberband_sys as ffi;
use thiserror::Error;

// Option flag values from rubberband-c.h. Bindgen may emit these as `i32` or
// `u32` depending on the host clang/MSVC ABI, so keep the portable literals.
const PROCESS_OFFLINE: i32 = 0x0000_0000;
const ENGINE_FINER: i32 = 0x2000_0000;
const PITCH_HIGH_QUALITY: i32 = 0x0200_0000;
const CHANNELS_TOGETHER: i32 = 0x1000_0000;
const THREADING_NEVER: i32 = 0x0001_0000;

const OFFLINE_OPTIONS: i32 =
    PROCESS_OFFLINE | ENGINE_FINER | PITCH_HIGH_QUALITY | CHANNELS_TOGETHER | THREADING_NEVER;

pub(crate) const PROCESS_CHUNK_FRAMES: usize = 4_096;

mod streaming;
pub use streaming::{StreamingSrc, source_frame_for_output};

/// Rounded output frame count for a source of `source_frames` at the given rates.
#[must_use]
pub fn expected_output_frames(source_frames: usize, source_rate: u32, target_rate: u32) -> usize {
    if source_rate == 0 {
        return 0;
    }
    ((source_frames as u128 * u128::from(target_rate) + u128::from(source_rate) / 2)
        / u128::from(source_rate)) as usize
}

/// Errors produced while preparing or running offline resampling.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ResampleError {
    /// A sample rate was zero.
    #[error("sample rate must be positive")]
    InvalidSampleRate,
    /// Channel count was zero.
    #[error("channel count must be positive")]
    InvalidChannelCount,
    /// Interleaved buffer length was not a multiple of the channel count.
    #[error("interleaved sample count must be a multiple of the channel count")]
    InvalidBufferLength,
    /// The native Rubber Band constructor failed.
    #[error("failed to create Rubber Band stretcher")]
    StretcherCreateFailed,
}

/// Offline resampler abstraction shared by clip decode and recording finalize.
///
/// Implementations may later add time-stretch or pitch-shift on the same
/// Rubber Band stretcher without changing call sites that only need SRC.
pub trait Resampler {
    /// Resample interleaved `f32` PCM from `source_rate` to `target_rate`.
    ///
    /// # Errors
    ///
    /// Returns [`ResampleError`] when rates, channels, or buffer layout are invalid.
    fn resample_interleaved(
        &self,
        interleaved: &[f32],
        channels: usize,
        source_rate: u32,
        target_rate: u32,
    ) -> Result<Vec<f32>, ResampleError>;
}

/// Rubber Band R3 offline sample-rate converter.
#[derive(Debug, Default, Clone, Copy)]
pub struct RubberBandResampler;

impl RubberBandResampler {
    /// Construct the shared offline resampler.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Resampler for RubberBandResampler {
    fn resample_interleaved(
        &self,
        interleaved: &[f32],
        channels: usize,
        source_rate: u32,
        target_rate: u32,
    ) -> Result<Vec<f32>, ResampleError> {
        resample_interleaved(interleaved, channels, source_rate, target_rate)
    }
}

/// Resample interleaved PCM with Rubber Band R3.
///
/// When rates match, returns a copy of the input. Output length is snapped to
/// the rounded expected frame count so mixer placement stays deterministic.
///
/// # Errors
///
/// Returns [`ResampleError`] for invalid rates, channel counts, or buffer sizes.
pub fn resample_interleaved(
    interleaved: &[f32],
    channels: usize,
    source_rate: u32,
    target_rate: u32,
) -> Result<Vec<f32>, ResampleError> {
    if source_rate == 0 || target_rate == 0 {
        return Err(ResampleError::InvalidSampleRate);
    }
    if channels == 0 {
        return Err(ResampleError::InvalidChannelCount);
    }
    if !interleaved.len().is_multiple_of(channels) {
        return Err(ResampleError::InvalidBufferLength);
    }
    let source_frames = interleaved.len() / channels;
    if source_frames == 0 || source_rate == target_rate {
        return Ok(interleaved.to_vec());
    }

    let expected_frames = expected_output_frames(source_frames, source_rate, target_rate);
    let time_ratio = f64::from(target_rate) / f64::from(source_rate);
    let pitch_scale = f64::from(source_rate) / f64::from(target_rate);

    // SAFETY: Options are a bitwise OR of documented Rubber Band flags. The
    // returned state is freed by `StretcherGuard::drop`.
    let state = unsafe {
        ffi::rubberband_new(
            source_rate,
            channels as u32,
            OFFLINE_OPTIONS,
            time_ratio,
            pitch_scale,
        )
    };
    if state.is_null() {
        return Err(ResampleError::StretcherCreateFailed);
    }
    let mut stretcher = StretcherGuard { state };

    // SAFETY: `state` is a live Rubber Band instance owned by this guard.
    unsafe {
        ffi::rubberband_set_expected_input_duration(stretcher.state, source_frames as u32);
        ffi::rubberband_set_max_process_size(stretcher.state, PROCESS_CHUNK_FRAMES as u32);
    }

    let planar = deinterleave(interleaved, channels);
    let mut offset = 0usize;
    while offset < source_frames {
        let end = (offset + PROCESS_CHUNK_FRAMES).min(source_frames);
        let final_block = end == source_frames;
        study_block(&mut stretcher, &planar, offset, end, final_block);
        offset = end;
    }

    let mut planar_out = vec![Vec::with_capacity(expected_frames); channels];
    offset = 0;
    while offset < source_frames {
        let end = (offset + PROCESS_CHUNK_FRAMES).min(source_frames);
        let final_block = end == source_frames;
        process_block(&mut stretcher, &planar, offset, end, final_block);
        offset = end;
        drain_available(&mut stretcher, channels, &mut planar_out);
    }
    drain_available(&mut stretcher, channels, &mut planar_out);

    for channel in &mut planar_out {
        channel.resize(expected_frames, 0.0);
    }
    Ok(interleave(&planar_out))
}

struct StretcherGuard {
    state: ffi::RubberBandState,
}

impl Drop for StretcherGuard {
    fn drop(&mut self) {
        if !self.state.is_null() {
            // SAFETY: state was created by rubberband_new and not yet deleted.
            unsafe { ffi::rubberband_delete(self.state) };
            self.state = ptr::null_mut();
        }
    }
}

fn study_block(
    stretcher: &mut StretcherGuard,
    planar: &[Vec<f32>],
    start: usize,
    end: usize,
    is_final: bool,
) {
    let pointers: Vec<*const f32> = planar
        .iter()
        .map(|channel| channel[start..end].as_ptr())
        .collect();
    // SAFETY: pointers reference disjoint planar slices for `end - start` frames.
    unsafe {
        ffi::rubberband_study(
            stretcher.state,
            pointers.as_ptr(),
            (end - start) as u32,
            i32::from(is_final),
        );
    }
}

fn process_block(
    stretcher: &mut StretcherGuard,
    planar: &[Vec<f32>],
    start: usize,
    end: usize,
    is_final: bool,
) {
    let pointers: Vec<*const f32> = planar
        .iter()
        .map(|channel| channel[start..end].as_ptr())
        .collect();
    // SAFETY: pointers reference disjoint planar slices for `end - start` frames.
    unsafe {
        ffi::rubberband_process(
            stretcher.state,
            pointers.as_ptr(),
            (end - start) as u32,
            i32::from(is_final),
        );
    }
}

fn drain_available(stretcher: &mut StretcherGuard, channels: usize, planar_out: &mut [Vec<f32>]) {
    loop {
        // SAFETY: state is live for the duration of this guard.
        let available = unsafe { ffi::rubberband_available(stretcher.state) };
        if available <= 0 {
            break;
        }
        let take = (available as usize).min(8_192);
        let mut chunk = vec![vec![0.0_f32; take]; channels];
        let pointers: Vec<*mut f32> = chunk
            .iter_mut()
            .map(|channel| channel.as_mut_ptr())
            .collect();
        // SAFETY: each channel buffer has `take` writable frames.
        let retrieved =
            unsafe { ffi::rubberband_retrieve(stretcher.state, pointers.as_ptr(), take as u32) }
                as usize;
        for (channel, samples) in planar_out.iter_mut().enumerate() {
            samples.extend_from_slice(&chunk[channel][..retrieved]);
        }
    }
}

pub(crate) fn deinterleave(interleaved: &[f32], channels: usize) -> Vec<Vec<f32>> {
    let frames = interleaved.len() / channels;
    let mut planar = vec![vec![0.0_f32; frames]; channels];
    for (frame, chunk) in interleaved.chunks_exact(channels).enumerate() {
        for (channel, sample) in chunk.iter().enumerate() {
            planar[channel][frame] = *sample;
        }
    }
    planar
}

fn interleave(planar: &[Vec<f32>]) -> Vec<f32> {
    let channels = planar.len();
    let frames = planar.first().map_or(0, Vec::len);
    let mut interleaved = vec![0.0_f32; frames.saturating_mul(channels)];
    for frame in 0..frames {
        for (channel, samples) in planar.iter().enumerate() {
            interleaved[frame * channels + channel] = samples[frame];
        }
    }
    interleaved
}

#[cfg(test)]
mod tests {
    use std::f32::consts::TAU;

    use rustfft::{FftPlanner, num_complex::Complex};

    use super::{ResampleError, Resampler, RubberBandResampler, resample_interleaved};

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

    fn expected_frames(source_frames: usize, source_rate: u32, target_rate: u32) -> usize {
        ((source_frames as u128 * u128::from(target_rate) + u128::from(source_rate) / 2)
            / u128::from(source_rate)) as usize
    }

    fn peak_frequency(samples: &[f32], channels: usize, sample_rate: u32) -> f32 {
        let frames = samples.len() / channels;
        let mut signal: Vec<Complex<f32>> = (0..frames)
            .map(|frame| Complex::new(samples[frame * channels], 0.0))
            .collect();
        let fft_len = signal.len().next_power_of_two();
        signal.resize(fft_len, Complex::new(0.0, 0.0));
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(fft_len);
        fft.process(&mut signal);
        let nyquist = fft_len / 2;
        let mut best_bin = 1usize;
        let mut best_mag = 0.0_f32;
        for (bin, value) in signal.iter().enumerate().take(nyquist).skip(1) {
            let magnitude = value.norm();
            if magnitude > best_mag {
                best_mag = magnitude;
                best_bin = bin;
            }
        }
        best_bin as f32 * sample_rate as f32 / fft_len as f32
    }

    fn highband_energy_ratio(samples: &[f32], channels: usize) -> f32 {
        let frames = samples.len() / channels;
        let mut signal: Vec<Complex<f32>> = (0..frames)
            .map(|frame| Complex::new(samples[frame * channels], 0.0))
            .collect();
        let fft_len = signal.len().next_power_of_two();
        signal.resize(fft_len, Complex::new(0.0, 0.0));
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(fft_len);
        fft.process(&mut signal);
        let nyquist = fft_len / 2;
        let mut peak_energy = 0.0_f32;
        let mut high_energy = 0.0_f32;
        let high_start = (nyquist * 9) / 10;
        for (bin, value) in signal.iter().enumerate().take(nyquist).skip(1) {
            let energy = value.norm_sqr();
            peak_energy = peak_energy.max(energy);
            if bin >= high_start {
                high_energy += energy;
            }
        }
        if peak_energy <= f32::EPSILON {
            return 0.0;
        }
        high_energy / (peak_energy * (nyquist - high_start).max(1) as f32)
    }

    #[test]
    fn rejects_invalid_configuration() {
        assert_eq!(
            resample_interleaved(&[0.0], 1, 0, 48_000),
            Err(ResampleError::InvalidSampleRate)
        );
        assert_eq!(
            resample_interleaved(&[0.0, 0.0], 0, 44_100, 48_000),
            Err(ResampleError::InvalidChannelCount)
        );
        assert_eq!(
            resample_interleaved(&[0.0], 2, 44_100, 48_000),
            Err(ResampleError::InvalidBufferLength)
        );
    }

    #[test]
    fn identity_when_rates_match() {
        let input = sine(128, 48_000, 440.0, 2);
        let output = resample_interleaved(&input, 2, 48_000, 48_000).expect("identity");
        assert_eq!(output, input);
    }

    #[test]
    fn resamples_44100_to_48000_preserving_sine_frequency() {
        let source_rate = 44_100;
        let target_rate = 48_000;
        let input = sine(source_rate as usize, source_rate, 440.0, 1);
        let output = RubberBandResampler::new()
            .resample_interleaved(&input, 1, source_rate, target_rate)
            .expect("resample 44.1k to 48k");
        assert_eq!(
            output.len(),
            expected_frames(input.len(), source_rate, target_rate)
        );
        let peak = peak_frequency(&output, 1, target_rate);
        assert!(
            (peak - 440.0).abs() < 4.0,
            "expected ~440 Hz peak, got {peak}"
        );
        assert!(
            highband_energy_ratio(&output, 1) < 0.05,
            "high-band energy suggests aliasing"
        );
    }

    #[test]
    fn resamples_48000_to_44100_preserving_sine_frequency() {
        let source_rate = 48_000;
        let target_rate = 44_100;
        let input = sine(source_rate as usize, source_rate, 440.0, 2);
        let output = resample_interleaved(&input, 2, source_rate, target_rate)
            .expect("resample 48k to 44.1k");
        assert_eq!(
            output.len() / 2,
            expected_frames(input.len() / 2, source_rate, target_rate)
        );
        let peak = peak_frequency(&output, 2, target_rate);
        assert!(
            (peak - 440.0).abs() < 4.0,
            "expected ~440 Hz peak, got {peak}"
        );
    }

    #[test]
    fn resamples_22050_to_48000_preserving_sine_frequency() {
        let source_rate = 22_050;
        let target_rate = 48_000;
        let input = sine(source_rate as usize, source_rate, 440.0, 1);
        let output = resample_interleaved(&input, 1, source_rate, target_rate)
            .expect("resample 22.05k to 48k");
        assert_eq!(
            output.len(),
            expected_frames(input.len(), source_rate, target_rate)
        );
        let peak = peak_frequency(&output, 1, target_rate);
        assert!(
            (peak - 440.0).abs() < 6.0,
            "expected ~440 Hz peak, got {peak}"
        );
        assert!(
            highband_energy_ratio(&output, 1) < 0.05,
            "high-band energy suggests aliasing"
        );
    }
}
