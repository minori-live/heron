//! Safe, runtime-dispatched SIMD helpers for mixer hot loops.
//!
//! `Level` is detected once in [`super::MixerGraph::prepare_block_processing`]
//! (outside the real-time path) and reused for every block. Production dispatch
//! includes `fearless_simd`'s scalar fallback backend; explicit scalar helpers
//! exist for parity tests. Entry points are `#[inline(never)]` so the per-frame
//! mixer path does not pull SIMD dispatch into its I-cache working set.

use fearless_simd::{Level, Simd, dispatch, prelude::*};
use fearless_simd_macros::simd;

use super::StereoFrame;

/// Detect the best SIMD level for this process. Call outside real-time paths.
#[inline]
pub(super) fn detect_level() -> Level {
    Level::new()
}

/// Scalar reference used by parity tests.
#[cfg(test)]
fn add_buses_into_stereo_scalar(
    frames: &mut [StereoFrame],
    buses: &[f32],
    left_bus: usize,
    right_bus: usize,
    frame_count: usize,
) {
    debug_assert_eq!(frames.len(), frame_count);
    let left_start = left_bus.saturating_mul(frame_count);
    let right_start = right_bus.saturating_mul(frame_count);
    debug_assert!(left_start + frame_count <= buses.len());
    debug_assert!(right_start + frame_count <= buses.len());
    for index in 0..frame_count {
        frames[index][0] += buses[left_start + index];
        frames[index][1] += buses[right_start + index];
    }
}

/// Scalar reference used by parity tests.
#[cfg(test)]
fn accumulate_stereo_to_bus_scalar(bus: &mut [f32], frames: &[StereoFrame], scale: f32) {
    debug_assert_eq!(bus.len(), frames.len());
    let frame_count = bus.len().min(frames.len());
    for index in 0..frame_count {
        bus[index] += (frames[index][0] + frames[index][1]) * scale;
    }
}

/// Scalar reference used by parity tests.
#[cfg(test)]
fn accumulate_stereo_to_stereo_bus_scalar(
    buses: &mut [f32],
    frames: &[StereoFrame],
    left_bus: usize,
    right_bus: usize,
    frame_count: usize,
) {
    debug_assert_eq!(frames.len(), frame_count);
    let left_start = left_bus.saturating_mul(frame_count);
    let right_start = right_bus.saturating_mul(frame_count);
    debug_assert!(left_start + frame_count <= buses.len());
    debug_assert!(right_start + frame_count <= buses.len());
    for index in 0..frame_count {
        buses[left_start + index] += frames[index][0];
        buses[right_start + index] += frames[index][1];
    }
}

/// Scalar reference used by parity tests.
#[cfg(test)]
fn peak_abs_stereo_scalar(frames: &[StereoFrame], peak: &mut StereoFrame) {
    let mut left = peak[0];
    let mut right = peak[1];
    for frame in frames {
        left = left.max(frame[0].abs());
        right = right.max(frame[1].abs());
    }
    peak[0] = left;
    peak[1] = right;
}

/// Copy channel-major stereo frames with fixed-size chunks.
#[cfg(test)]
fn copy_stereo_frames_scalar(destination: &mut [StereoFrame], source: &[StereoFrame]) {
    let frame_count = destination.len().min(source.len());
    let (destination, source) = (&mut destination[..frame_count], &source[..frame_count]);
    let (destination_chunks, destination_tail) = destination.as_chunks_mut::<8>();
    let (source_chunks, source_tail) = source.as_chunks::<8>();
    for (destination_chunk, source_chunk) in destination_chunks.iter_mut().zip(source_chunks) {
        *destination_chunk = *source_chunk;
    }
    for (destination_frame, source_frame) in destination_tail.iter_mut().zip(source_tail) {
        *destination_frame = *source_frame;
    }
}

#[simd]
fn add_buses_into_stereo_kernel<S: Simd>(
    simd: S,
    frames: &mut [StereoFrame],
    buses: &[f32],
    left_bus: usize,
    right_bus: usize,
    frame_count: usize,
) {
    debug_assert_eq!(frames.len(), frame_count);
    let left_start = left_bus.saturating_mul(frame_count);
    let right_start = right_bus.saturating_mul(frame_count);
    debug_assert!(left_start + frame_count <= buses.len());
    debug_assert!(right_start + frame_count <= buses.len());

    let mut offset = 0;
    while offset + S::f32s::LEN <= frame_count {
        let left = S::f32s::from_fn(simd, |lane| buses[left_start + offset + lane]);
        let right = S::f32s::from_fn(simd, |lane| buses[right_start + offset + lane]);
        let current_left = S::f32s::from_fn(simd, |lane| frames[offset + lane][0]);
        let current_right = S::f32s::from_fn(simd, |lane| frames[offset + lane][1]);
        let out_left = current_left + left;
        let out_right = current_right + right;
        for lane in 0..S::f32s::LEN {
            frames[offset + lane][0] = out_left[lane];
            frames[offset + lane][1] = out_right[lane];
        }
        offset += S::f32s::LEN;
    }
    while offset < frame_count {
        frames[offset][0] += buses[left_start + offset];
        frames[offset][1] += buses[right_start + offset];
        offset += 1;
    }
}

#[simd]
fn accumulate_stereo_to_bus_kernel<S: Simd>(
    simd: S,
    bus: &mut [f32],
    frames: &[StereoFrame],
    scale: f32,
) {
    debug_assert_eq!(bus.len(), frames.len());
    let frame_count = bus.len().min(frames.len());
    let bus = &mut bus[..frame_count];
    let frames = &frames[..frame_count];
    let scale_v = S::f32s::splat(simd, scale);

    let mut bus_chunks = bus.chunks_exact_mut(S::f32s::LEN);
    let mut frame_chunks = frames.chunks_exact(S::f32s::LEN);
    for (bus_chunk, frame_chunk) in (&mut bus_chunks).zip(&mut frame_chunks) {
        let left = S::f32s::from_fn(simd, |lane| frame_chunk[lane][0]);
        let right = S::f32s::from_fn(simd, |lane| frame_chunk[lane][1]);
        let current = S::f32s::from_slice(simd, bus_chunk);
        let summed = (left + right) * scale_v + current;
        summed.store_slice(bus_chunk);
    }

    for (sample, frame) in bus_chunks
        .into_remainder()
        .iter_mut()
        .zip(frame_chunks.remainder())
    {
        *sample += (frame[0] + frame[1]) * scale;
    }
}

#[simd]
fn accumulate_stereo_to_stereo_bus_kernel<S: Simd>(
    simd: S,
    buses: &mut [f32],
    frames: &[StereoFrame],
    left_bus: usize,
    right_bus: usize,
    frame_count: usize,
) {
    debug_assert_eq!(frames.len(), frame_count);
    let left_start = left_bus.saturating_mul(frame_count);
    let right_start = right_bus.saturating_mul(frame_count);
    debug_assert!(left_start + frame_count <= buses.len());
    debug_assert!(right_start + frame_count <= buses.len());

    let mut offset = 0;
    while offset + S::f32s::LEN <= frame_count {
        let left = S::f32s::from_fn(simd, |lane| frames[offset + lane][0]);
        let right = S::f32s::from_fn(simd, |lane| frames[offset + lane][1]);
        let current_left = S::f32s::from_fn(simd, |lane| buses[left_start + offset + lane]);
        let current_right = S::f32s::from_fn(simd, |lane| buses[right_start + offset + lane]);
        let out_left = current_left + left;
        let out_right = current_right + right;
        for lane in 0..S::f32s::LEN {
            buses[left_start + offset + lane] = out_left[lane];
            buses[right_start + offset + lane] = out_right[lane];
        }
        offset += S::f32s::LEN;
    }
    while offset < frame_count {
        buses[left_start + offset] += frames[offset][0];
        buses[right_start + offset] += frames[offset][1];
        offset += 1;
    }
}

#[simd]
fn peak_abs_stereo_kernel<S: Simd>(simd: S, frames: &[StereoFrame], peak: &mut StereoFrame) {
    let mut peak_left = S::f32s::splat(simd, peak[0]);
    let mut peak_right = S::f32s::splat(simd, peak[1]);
    let mut chunks = frames.chunks_exact(S::f32s::LEN);
    for chunk in &mut chunks {
        let left = S::f32s::from_fn(simd, |lane| chunk[lane][0]).abs();
        let right = S::f32s::from_fn(simd, |lane| chunk[lane][1]).abs();
        peak_left = peak_left.max(left);
        peak_right = peak_right.max(right);
    }
    let mut left = peak_left.reduce_max();
    let mut right = peak_right.reduce_max();
    for frame in chunks.remainder() {
        left = left.max(frame[0].abs());
        right = right.max(frame[1].abs());
    }
    peak[0] = left;
    peak[1] = right;
}

/// Runtime-dispatched bus → stereo accumulation.
#[inline(never)]
pub(super) fn add_buses_into_stereo(
    level: Level,
    frames: &mut [StereoFrame],
    buses: &[f32],
    left_bus: usize,
    right_bus: usize,
    frame_count: usize,
) {
    dispatch!(
        level,
        simd => add_buses_into_stereo_kernel(simd, frames, buses, left_bus, right_bus, frame_count)
    );
}

/// Runtime-dispatched stereo → mono bus accumulation (`(L+R)*scale`).
#[inline(never)]
pub(super) fn accumulate_stereo_to_bus(
    level: Level,
    bus: &mut [f32],
    frames: &[StereoFrame],
    scale: f32,
) {
    dispatch!(level, simd => accumulate_stereo_to_bus_kernel(simd, bus, frames, scale));
}

/// Runtime-dispatched stereo → adjacent stereo bus lanes (L and R separately).
#[inline(never)]
pub(super) fn accumulate_stereo_to_stereo_bus(
    level: Level,
    buses: &mut [f32],
    frames: &[StereoFrame],
    left_bus: usize,
    right_bus: usize,
    frame_count: usize,
) {
    dispatch!(
        level,
        simd => accumulate_stereo_to_stereo_bus_kernel(
            simd,
            buses,
            frames,
            left_bus,
            right_bus,
            frame_count
        )
    );
}

/// Runtime-dispatched stereo absolute-peak fold.
#[inline(never)]
pub(super) fn peak_abs_stereo(level: Level, frames: &[StereoFrame], peak: &mut StereoFrame) {
    dispatch!(level, simd => peak_abs_stereo_kernel(simd, frames, peak));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_close(actual: f32, expected: f32) {
        let delta = (actual - expected).abs();
        assert!(
            delta <= 1.0e-6,
            "value {actual} differed from {expected} by {delta}"
        );
    }

    fn assert_frames_close(actual: &[StereoFrame], expected: &[StereoFrame]) {
        assert_eq!(actual.len(), expected.len());
        for (actual_frame, expected_frame) in actual.iter().zip(expected) {
            assert_close(actual_frame[0], expected_frame[0]);
            assert_close(actual_frame[1], expected_frame[1]);
        }
    }

    #[test]
    fn bus_into_stereo_matches_scalar() {
        let level = detect_level();
        let frame_count = 64;
        let mut buses = vec![0.0; frame_count * 2];
        for index in 0..frame_count {
            buses[index] = index as f32 * 0.01;
            buses[frame_count + index] = index as f32 * -0.02;
        }
        let mut simd_frames = vec![[0.25, -0.5]; frame_count];
        let mut scalar_frames = simd_frames.clone();
        add_buses_into_stereo(level, &mut simd_frames, &buses, 0, 1, frame_count);
        add_buses_into_stereo_scalar(&mut scalar_frames, &buses, 0, 1, frame_count);
        assert_frames_close(&simd_frames, &scalar_frames);

        let mut same_bus_simd = vec![[0.1, 0.2]; frame_count];
        let mut same_bus_scalar = same_bus_simd.clone();
        add_buses_into_stereo(level, &mut same_bus_simd, &buses, 0, 0, frame_count);
        add_buses_into_stereo_scalar(&mut same_bus_scalar, &buses, 0, 0, frame_count);
        assert_frames_close(&same_bus_simd, &same_bus_scalar);
    }

    #[test]
    fn stereo_to_bus_matches_scalar() {
        let level = detect_level();
        let frames: Vec<StereoFrame> = (0..65)
            .map(|index| [index as f32 * 0.03, index as f32 * -0.04])
            .collect();
        let mut simd_bus = vec![0.125; 65];
        let mut scalar_bus = simd_bus.clone();
        accumulate_stereo_to_bus(level, &mut simd_bus, &frames, 0.5);
        accumulate_stereo_to_bus_scalar(&mut scalar_bus, &frames, 0.5);
        for (actual, expected) in simd_bus.iter().zip(&scalar_bus) {
            assert_close(*actual, *expected);
        }
    }

    #[test]
    fn stereo_to_stereo_bus_matches_scalar() {
        let level = detect_level();
        let frame_count = 63;
        let frames: Vec<StereoFrame> = (0..frame_count)
            .map(|index| [index as f32 * 0.05, index as f32 * -0.07])
            .collect();
        let mut simd_buses = vec![0.25; frame_count * 2];
        let mut scalar_buses = simd_buses.clone();
        accumulate_stereo_to_stereo_bus(level, &mut simd_buses, &frames, 0, 1, frame_count);
        accumulate_stereo_to_stereo_bus_scalar(&mut scalar_buses, &frames, 0, 1, frame_count);
        for (actual, expected) in simd_buses.iter().zip(&scalar_buses) {
            assert_close(*actual, *expected);
        }
    }

    #[test]
    fn peak_abs_matches_scalar() {
        let level = detect_level();
        let frames: Vec<StereoFrame> = (0..67)
            .map(|index| {
                let value = (index as f32 * 0.07) - 1.5;
                [value, -value * 0.5]
            })
            .collect();
        let mut simd_peak = [0.1, 0.2];
        let mut scalar_peak = simd_peak;
        peak_abs_stereo(level, &frames, &mut simd_peak);
        peak_abs_stereo_scalar(&frames, &mut scalar_peak);
        assert_close(simd_peak[0], scalar_peak[0]);
        assert_close(simd_peak[1], scalar_peak[1]);
    }

    #[test]
    fn copy_stereo_frames_preserves_values() {
        let source: Vec<StereoFrame> = (0..19).map(|index| [index as f32, -index as f32]).collect();
        let mut destination = vec![[0.0, 0.0]; source.len()];
        copy_stereo_frames_scalar(&mut destination, &source);
        assert_eq!(destination, source);
    }
}
