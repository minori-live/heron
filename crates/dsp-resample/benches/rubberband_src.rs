//! Rubber Band R3 sample-rate conversion.
//!
//! Offline conversion is the clip-import and recording-finalize path. Streaming
//! conversion is the prefetch stretcher used when a clip's file rate differs
//! from the session rate. Inputs are a deterministic 440 Hz sine.

use std::{f32::consts::TAU, hint::black_box, time::Duration};

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use heron_dsp_resample::{StreamingSrc, resample_interleaved};

fn sine(sample_rate: u32, channels: usize, frames: usize) -> Vec<f32> {
    let mut samples = Vec::with_capacity(frames.saturating_mul(channels));
    for frame in 0..frames {
        let value = (frame as f32 / sample_rate as f32 * 440.0 * TAU).sin() * 0.25;
        for _ in 0..channels {
            samples.push(value);
        }
    }
    samples
}

fn group<'a>(
    criterion: &'a mut Criterion,
    name: &str,
) -> criterion::BenchmarkGroup<'a, criterion::measurement::WallTime> {
    let mut group = criterion.benchmark_group(name);
    group
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(4))
        .sample_size(20)
        .noise_threshold(0.05);
    group
}

fn bench_offline(c: &mut Criterion) {
    let mut group = group(c, "dsp-resample/rubberband/offline");
    let frames = 48_000_usize;
    let channels = 2_usize;
    let input = sine(44_100, channels, frames);
    group.throughput(Throughput::Elements(frames as u64));
    group.bench_function("stereo/44100-to-48000/frames=48000", |bencher| {
        bencher.iter(|| {
            black_box(
                resample_interleaved(black_box(&input), channels, 44_100, 48_000)
                    .expect("offline resample"),
            )
        });
    });
    group.finish();
}

fn bench_streaming(c: &mut Criterion) {
    let mut group = group(c, "dsp-resample/rubberband/streaming");
    let chunk_frames = 4_096_usize;
    let channels = 2_usize;
    let input = sine(44_100, channels, chunk_frames);
    let mut stretcher = StreamingSrc::new(channels, 44_100, 48_000).expect("streaming stretcher");
    let mut output = Vec::new();
    // Prime start pad so measured iterations are steady-state prefetch chunks.
    stretcher
        .process_interleaved(&input, false)
        .expect("prime streaming stretcher");
    output.clear();
    stretcher.retrieve_all_interleaved(&mut output);

    group.throughput(Throughput::Elements(chunk_frames as u64));
    group.bench_function("stereo/44100-to-48000/chunk=4096", |bencher| {
        bencher.iter(|| {
            stretcher
                .process_interleaved(black_box(&input), false)
                .expect("streaming resample");
            output.clear();
            black_box(stretcher.retrieve_all_interleaved(&mut output));
        });
    });
    group.finish();
}

criterion_group!(benches, bench_offline, bench_streaming);
criterion_main!(benches);
