//! Prove Heron's realtime host applies coarse and fine pitch to the released Revox bundle.

use std::{
    path::PathBuf,
    process::Command,
    rc::Rc,
    thread,
    time::{Duration, Instant},
};

use heron_vst3_host::{AudioLayout, Module, PluginKind, StereoProcessor};

const TEST_NAME: &str = "packaged_revox_applies_coarse_and_fine_pitch_through_the_realtime_host";
const CHILD_ENV: &str = "HERON_REVOX_BUNDLE_TEST_CHILD";
const SAMPLE_RATE: f64 = 48_000.0;
const BLOCK_FRAMES: usize = 257;
const WINDOW_FRAMES: usize = 24_000;
const STABLE_WINDOWS: usize = 4;
const INPUT_HZ: f64 = 220.0;

#[test]
#[ignore = "requires prepared producer VST3 artifacts; run with --test-threads=1"]
fn packaged_revox_applies_coarse_and_fine_pitch_through_the_realtime_host() {
    if std::env::var_os(CHILD_ENV).as_deref() == Some(std::ffi::OsStr::new("1")) {
        verify_hosted_audio();
        return;
    }

    // Restrict inference to CPU in this test process only, including on Apple
    // Silicon. Never mutate the test runner's process-wide environment. The
    // timeout also bounds native model loading and plugin teardown if either
    // hangs; it does not change Heron's production process mode or lifecycle.
    let mut child = Command::new(std::env::current_exe().expect("integration test executable"))
        .args([
            "--exact",
            TEST_NAME,
            "--ignored",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_ENV, "1")
        .env("HERON_REVOX_FORCE_CPU", "1")
        .spawn()
        .expect("start isolated Revox host test");
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().expect("poll isolated Revox host test") {
            assert!(status.success(), "Revox host test exited with {status}");
            break;
        }
        if started.elapsed() >= Duration::from_secs(60) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("Revox host test exceeded its 60-second loading/audio/teardown deadline");
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn verify_hosted_audio() {
    verify_pitch_gate();
    let bundle = bundle_path();
    eprintln!(
        "Loading released Revox through Heron's realtime host: {}",
        bundle.display()
    );
    let module = Rc::new(Module::open(&bundle).expect("load released Revox bundle"));
    let class = "801E1EF7D1FBA46DD7EE039C0317622C".parse().unwrap();
    let mut processor = StereoProcessor::create_with_layout(
        module,
        class,
        SAMPLE_RATE,
        PluginKind::Effect,
        AudioLayout::Stereo,
    )
    .expect("activate released Revox in Heron's stereo realtime host");
    let latency = processor.latency_samples() as usize;
    assert!(
        (1..240_000).contains(&latency),
        "implausible hosted latency: {latency}"
    );
    // Stable public parameter IDs: +3 semitones in [-12, 12] and +50 cents
    // in [-100, 100]. A +3-only result misses the 25-cent acceptance interval.
    assert!(
        processor.queue_parameter_change(0, 0, 0.625),
        "coarse pitch queue"
    );
    assert!(
        processor.queue_parameter_change(0, 1, 0.75),
        "fine pitch queue"
    );

    let mut input_left = [0.0_f32; BLOCK_FRAMES];
    let mut input_right = input_left;
    let mut output_left = input_left;
    let mut output_right = input_left;
    let mut windows = [
        Vec::with_capacity(WINDOW_FRAMES + BLOCK_FRAMES),
        Vec::with_capacity(WINDOW_FRAMES + BLOCK_FRAMES),
    ];
    let mut position = 0_usize;
    let mut stable = 0;
    let started = Instant::now();
    // Model startup runs asynchronously on Revox's worker. Allow bounded
    // warmup, then require two consecutive seconds of actual shifted output.
    // No provider status, parameter readback or nonzero dry audio can pass.
    while started.elapsed() < Duration::from_secs(30) {
        for (index, sample) in input_left.iter_mut().enumerate() {
            *sample = input_sample(position + index, INPUT_HZ);
        }
        input_right.copy_from_slice(&input_left);
        processor
            .process_stereo(
                &mut input_left,
                &mut input_right,
                &mut output_left,
                &mut output_right,
            )
            .expect("process released Revox through Heron's realtime VST3 API");
        for (channel, output) in [output_left, output_right].iter().enumerate() {
            assert!(
                output.iter().all(|sample| sample.is_finite()),
                "non-finite channel {channel}"
            );
            let preroll = latency.saturating_sub(position).min(BLOCK_FRAMES);
            assert!(
                output[..preroll].iter().all(|sample| sample.abs() < 1.0e-6),
                "channel {channel} produced audio before its reported latency"
            );
            windows[channel].extend_from_slice(output);
        }
        position += BLOCK_FRAMES;
        if windows[0].len() >= WINDOW_FRAMES {
            if position >= latency + WINDOW_FRAMES * 2 {
                let measurements = [
                    measure_pitch(&windows[0][..WINDOW_FRAMES]),
                    measure_pitch(&windows[1][..WINDOW_FRAMES]),
                ];
                eprintln!(
                    "Revox realtime {:.2}s, latency={latency}: left={:?}, right={:?}",
                    position as f64 / SAMPLE_RATE,
                    measurements[0],
                    measurements[1]
                );
                if measurements.iter().all(PitchMeasurement::is_shifted) {
                    stable += 1;
                } else {
                    stable = 0;
                }
                if stable == STABLE_WINDOWS {
                    return;
                }
            }
            for window in &mut windows {
                drop(window.drain(..WINDOW_FRAMES));
            }
        }
        // Use one absolute clock so processing/measurement time is included;
        // per-block sleeps would silently grant extra inference time each block.
        let deadline = Duration::from_secs_f64(position as f64 / SAMPLE_RATE);
        thread::sleep(deadline.saturating_sub(started.elapsed()));
    }
    panic!("Revox did not sustain +3.5 semitones on both channels within 30 seconds");
}

#[derive(Debug)]
struct PitchMeasurement {
    hz: f64,
    rms: f64,
    correlation: f64,
    cents: f64,
}

impl PitchMeasurement {
    fn is_shifted(&self) -> bool {
        self.hz.is_finite()
            && self.rms > 0.0001
            && self.correlation > 0.8
            && self.cents.abs() < 25.0
    }
}

fn measure_pitch(samples: &[f32]) -> PitchMeasurement {
    let mean = samples.iter().map(|&sample| f64::from(sample)).sum::<f64>() / samples.len() as f64;
    let rms = (samples
        .iter()
        .map(|&sample| (f64::from(sample) - mean).powi(2))
        .sum::<f64>()
        / samples.len() as f64)
        .sqrt();
    let mut best_correlation = f64::NEG_INFINITY;
    let mut best_lag = 0;
    // Cover the input and requested pitch, retaining one-sample lag resolution.
    // Subsample the dot products to keep inspection cheap between audio blocks.
    for lag in 140..320 {
        let mut xy = 0.0;
        let mut xx = 0.0;
        let mut yy = 0.0;
        for index in (0..samples.len() - 320).step_by(4) {
            let a = f64::from(samples[index]) - mean;
            let b = f64::from(samples[index + lag]) - mean;
            xy += a * b;
            xx += a * a;
            yy += b * b;
        }
        let correlation = xy / (xx * yy).sqrt();
        if correlation > best_correlation {
            best_correlation = correlation;
            best_lag = lag;
        }
    }
    let hz = SAMPLE_RATE / best_lag as f64;
    let expected = INPUT_HZ * 2.0_f64.powf(3.5 / 12.0);
    PitchMeasurement {
        hz,
        rms,
        correlation: best_correlation,
        cents: 1200.0 * (hz / expected).log2(),
    }
}

fn verify_pitch_gate() {
    // Negative controls for this acceptance oracle: delayed dry is periodic at
    // 220 Hz, and losing fine automation yields +3 instead of +3.5 semitones.
    for semitones in [0.0, 3.0, 3.5] {
        let frequency = INPUT_HZ * 2.0_f64.powf(semitones / 12.0);
        let samples: Vec<_> = (0..WINDOW_FRAMES)
            .map(|position| input_sample(position, frequency))
            .collect();
        let measured = measure_pitch(&samples);
        assert_eq!(
            measured.is_shifted(),
            semitones > 3.0,
            "pitch gate: {measured:?}"
        );
    }
}

fn input_sample(position: usize, frequency: f64) -> f32 {
    let phase = std::f64::consts::TAU * frequency * position as f64 / SAMPLE_RATE;
    (0.15 * phase.sin() + 0.07 * (2.0 * phase).sin() + 0.04 * (3.0 * phase).sin()) as f32
}

fn bundle_path() -> PathBuf {
    std::env::var_os("HERON_REVOX_BUNDLE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/bundles/Heron Revox.vst3")
        })
}
