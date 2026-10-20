//! Multi-resolution waveform peaks built by recording finalize and clip import.
//!
//! Samples are a deterministic stereo sine. The bench counts pyramid levels so
//! the peak walk cannot be deleted.

use std::{f32::consts::TAU, hint::black_box, time::Duration};

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use heron_dsp_node::benchmark_waveform_levels;

fn sine(frames: usize) -> Vec<f32> {
    let mut samples = Vec::with_capacity(frames.saturating_mul(2));
    for frame in 0..frames {
        let value = (frame as f32 / 48_000.0 * 440.0 * TAU).sin() * 0.5;
        samples.push(value);
        samples.push(-value * 0.75);
    }
    samples
}

fn bench_peaks(c: &mut Criterion) {
    let mut group = c.benchmark_group("dsp-node/waveform_peaks");
    group
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(3))
        .sample_size(30)
        .noise_threshold(0.03);
    for &(label, seconds) in &[("10s", 10_usize), ("3min", 180)] {
        let frames = 48_000 * seconds;
        let samples = sine(frames);
        group.throughput(Throughput::Elements(frames as u64));
        group.bench_function(format!("stereo/48kHz/{label}"), |bencher| {
            bencher.iter(|| black_box(benchmark_waveform_levels(black_box(&samples), 2)));
        });
    }
    group.finish();
}

criterion_group!(benches, bench_peaks);
criterion_main!(benches);
