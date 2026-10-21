//! Real-time playback and the device-rate bridge.
//!
//! Benchmark ids include the 48 kHz callback budget in microseconds
//! (`block_frames * 1_000_000 / sample_rate`). Divide the measured mean by that
//! budget for deadline utilization. These figures are local measurements, not
//! a CI gate.

use std::{hint::black_box, time::Duration};

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use heron_audio_engine::bench_support::{RenderHarness, RenderScenario, SessionRateBridgeHarness};

fn realtime_scenario(
    tracks: usize,
    clips: usize,
    active_clips: usize,
    amplitude: f32,
) -> RenderScenario {
    RenderScenario {
        sample_rate: 48_000,
        tracks,
        total_clips: clips,
        active_clips,
        clip_frames: 4_096,
        amplitude,
    }
}

fn budget_us(frames: usize) -> u64 {
    (frames as u64) * 1_000_000 / 48_000
}

fn cpu_group<'a>(
    criterion: &'a mut Criterion,
    name: &str,
) -> criterion::BenchmarkGroup<'a, criterion::measurement::WallTime> {
    let mut group = criterion.benchmark_group(name);
    group
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(3))
        .sample_size(50)
        .noise_threshold(0.03);
    group
}

fn bench_realtime_budget(c: &mut Criterion) {
    let mut group = cpu_group(c, "audio-engine/playback_graph/realtime_budget");
    for &tracks in &[8_usize, 32, 128] {
        for &block_frames in &[64_usize, 128, 512] {
            group.throughput(Throughput::Elements(block_frames as u64));
            let mut harness = RenderHarness::new(realtime_scenario(tracks, tracks, tracks, 0.125));
            group.bench_function(
                format!(
                    "48kHz/tracks={tracks}/clips={tracks}/block={block_frames}/budget={}us",
                    budget_us(block_frames)
                ),
                |bencher| {
                    bencher.iter(|| black_box(harness.render_block(block_frames)));
                },
            );
        }
    }
    group.finish();
}

fn bench_idle_clips(c: &mut Criterion) {
    let mut group = cpu_group(c, "audio-engine/playback_graph/idle_clips");
    let block_frames = 128_usize;
    group.throughput(Throughput::Elements(block_frames as u64));
    let mut harness = RenderHarness::new(realtime_scenario(32, 128, 32, 0.125));
    group.bench_function(
        format!(
            "48kHz/tracks=32/active-clips=32/idle-clips=96/block={block_frames}/budget={}us",
            budget_us(block_frames)
        ),
        |bencher| {
            bencher.iter(|| black_box(harness.render_block(block_frames)));
        },
    );
    group.finish();
}

fn bench_subnormals(c: &mut Criterion) {
    let mut group = cpu_group(c, "audio-engine/playback_graph/subnormals");
    let block_frames = 128_usize;
    group.throughput(Throughput::Elements(block_frames as u64));
    let mut harness = RenderHarness::new(realtime_scenario(32, 32, 32, 1.0e-40));
    group.bench_function(
        format!(
            "48kHz/tracks=32/block={block_frames}/budget={}us/amplitude=1e-40",
            budget_us(block_frames)
        ),
        |bencher| {
            bencher.iter(|| black_box(harness.render_block(block_frames)));
        },
    );
    group.finish();
}

fn bench_offline(c: &mut Criterion) {
    let mut group = cpu_group(c, "audio-engine/playback_graph/offline");
    let frames = 48_000_usize;
    group.throughput(Throughput::Elements(frames as u64));
    for &(label, tracks) in &[("track-freeze", 1_usize), ("mix", 32)] {
        let mut harness = RenderHarness::new(RenderScenario {
            sample_rate: 48_000,
            tracks,
            total_clips: tracks,
            active_clips: tracks,
            clip_frames: frames,
            amplitude: 0.125,
        });
        group.bench_function(
            format!("48kHz/{label}/tracks={tracks}/frames={frames}"),
            |bencher| {
                bencher.iter(|| black_box(harness.render_block(frames)));
            },
        );
    }
    group.finish();
}

fn bench_input_bridge(c: &mut Criterion) {
    let mut group = cpu_group(c, "audio-engine/playback_graph/input_bridge");
    for &(input_rate, session_rate, output_rate) in
        &[(48_000_u32, 48_000, 48_000), (44_100, 48_000, 48_000)]
    {
        for &block_frames in &[64_usize, 128, 512] {
            group.throughput(Throughput::Elements(block_frames as u64));
            let mut harness = SessionRateBridgeHarness::new(input_rate, session_rate, output_rate);
            let budget = if session_rate == 48_000 {
                format!("/budget={}us", budget_us(block_frames))
            } else {
                String::new()
            };
            group.bench_function(
                format!(
                    "in={input_rate}/session={session_rate}/out={output_rate}/block={block_frames}{budget}"
                ),
                |bencher| {
                    bencher.iter(|| black_box(harness.render_device_block(block_frames)));
                },
            );
        }
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_realtime_budget,
    bench_idle_clips,
    bench_subnormals,
    bench_offline,
    bench_input_bridge
);
criterion_main!(benches);
