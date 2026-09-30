use std::{
    fs,
    hint::black_box,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use heron_audio_host::recording::{RecorderController, RecordingStartConfig};
use heron_dsp_node::{FinalizeRecordingTask, NativeFinalizeRecordingConfig};
use napi::Task;
use std::{sync::Arc, sync::atomic::AtomicU32};

mod common;

use common::write_float_fixture;

/// Resamples and re-encodes `input` into `output`, returning the frame count.
fn finalize_fixture(
    input: &std::path::Path,
    output: &std::path::Path,
    target_sample_rate: u32,
    bit_depth: &str,
    channel_indices: Option<Vec<u32>>,
) -> i64 {
    // The benchmark drives the same `compute` the napi task runs, so it
    // measures the shipping path without a second entry point.
    FinalizeRecordingTask::new(NativeFinalizeRecordingConfig {
        input_path: input.to_string_lossy().into_owned(),
        output_path: output.to_string_lossy().into_owned(),
        target_sample_rate,
        bit_depth: bit_depth.to_owned(),
        asset_id: format!("benchmark-{target_sample_rate}-{bit_depth}"),
        originator: "Heron benchmark".to_owned(),
        origination_date: "2026-01-01".to_owned(),
        origination_time: "00:00:00".to_owned(),
        time_reference: 0,
        channel_indices,
    })
    .compute()
    .expect("finalize benchmark recording")
    .frame_count
}

/// Records `frames` frames through the engine's writer and returns the frames
/// it committed.
fn write_recording_session(
    path: &std::path::Path,
    sample_rate: u32,
    channels: usize,
    frames: usize,
    callback_frames: usize,
) -> i64 {
    let channels = channels as u32;
    // The tap captures while the transport state it was created with matches.
    let (controller, mut tap) =
        RecorderController::new(sample_rate, Arc::new(AtomicU32::new(0)), 0);
    controller
        .start(RecordingStartConfig {
            path: path.to_string_lossy().into_owned(),
            asset_id: "benchmark-writer".to_owned(),
            originator: "Heron benchmark".to_owned(),
            origination_date: "2026-01-01".to_owned(),
            origination_time: "00:00:00".to_owned(),
            time_reference: 0,
            sample_rate,
            channels,
        })
        .expect("start benchmark recording");
    let block = vec![0.125_f32; callback_frames * channels as usize];
    let mut written = 0;
    while written < frames {
        let take = callback_frames.min(frames - written);
        for frame in block[..take * channels as usize].chunks_exact(channels as usize) {
            tap.push(frame);
        }
        written += take;
    }
    controller
        .stop()
        .expect("stop benchmark recording")
        .frame_count
}

struct FixtureDirectory {
    path: PathBuf,
}

impl FixtureDirectory {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time moves forward")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "heron-criterion-recording-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create benchmark fixture directory");
        Self { path }
    }

    fn file(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Drop for FixtureDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn io_group<'a>(
    criterion: &'a mut Criterion,
    name: &str,
) -> criterion::BenchmarkGroup<'a, criterion::measurement::WallTime> {
    let mut group = criterion.benchmark_group(name);
    group
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(10))
        .sample_size(10)
        .noise_threshold(0.10);
    group
}

fn bench_writer(c: &mut Criterion) {
    let directory = FixtureDirectory::new();
    let output = directory.file("writer-session.bwf");
    let frames = 48_000_usize;
    let mut group = io_group(c, "dsp-node/recording/writer");
    group.throughput(Throughput::Elements(frames as u64));
    for &channels in &[2_usize, 8, 32] {
        group.bench_function(format!("channels={channels}/duration=1s"), |bencher| {
            bencher.iter(|| {
                black_box(write_recording_session(
                    &output, 48_000, channels, frames, 256,
                ))
            });
        });
    }
    group.finish();
}

fn bench_finalize(c: &mut Criterion) {
    let directory = FixtureDirectory::new();
    let native_input = directory.file("input-48k-stereo.bwf");
    let resample_input = directory.file("input-44k-stereo.bwf");
    let _ = write_float_fixture(&native_input, 48_000, 2, 48_000 * 10);
    let _ = write_float_fixture(&resample_input, 44_100, 2, 44_100 * 10);
    let mut group = io_group(c, "dsp-node/recording/finalize");
    group.throughput(Throughput::Elements(480_000));
    for &(source_rate, input) in &[(48_000_u32, &native_input), (44_100_u32, &resample_input)] {
        for &bit_depth in &["float32", "pcm24", "pcm16"] {
            let output = directory.file(&format!("output-{source_rate}-{bit_depth}.bwf"));
            group.bench_function(
                format!("{source_rate}-to-48000/{bit_depth}/stereo-10s"),
                |bencher| {
                    bencher.iter(|| {
                        black_box(finalize_fixture(input, &output, 48_000, bit_depth, None))
                    });
                },
            );
        }
    }
    group.finish();
}

criterion_group!(benches, bench_writer, bench_finalize);
criterion_main!(benches);
