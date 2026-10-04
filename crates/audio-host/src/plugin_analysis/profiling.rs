//! Opt-in native-stage measurements. This module and its call sites only exist
//! in test builds; wall-clock results are diagnostic, never a CI assertion.

use super::{Chain, PluginAnalysisJobStatus, PluginAnalysisSettings, worker};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    hint::black_box,
    sync::{Arc, Mutex, atomic::AtomicBool},
    time::{Duration, Instant},
};

struct Measurement {
    current: &'static str,
    since: Instant,
    stages: BTreeMap<&'static str, Duration>,
    captures: usize,
    frames: usize,
    capture_time: Duration,
}

thread_local! {
    static MEASUREMENT: RefCell<Option<Measurement>> = const { RefCell::new(None) };
}

pub(super) fn stage(name: &'static str) {
    MEASUREMENT.with_borrow_mut(|current| {
        if let Some(measurement) = current {
            *measurement.stages.entry(measurement.current).or_default() +=
                measurement.since.elapsed();
            measurement.current = name;
            measurement.since = Instant::now();
        }
    });
}

pub(super) struct Capture(Option<Instant>);

pub(super) fn capture(frames: usize) -> Capture {
    Capture(MEASUREMENT.with_borrow_mut(|current| {
        current.as_mut().map(|measurement| {
            measurement.captures += 1;
            measurement.frames += frames;
            Instant::now()
        })
    }))
}

impl Drop for Capture {
    fn drop(&mut self) {
        if let Some(started) = self.0 {
            MEASUREMENT.with_borrow_mut(|current| {
                if let Some(measurement) = current {
                    measurement.capture_time += started.elapsed();
                }
            });
        }
    }
}

#[test]
#[ignore = "diagnostic release-mode timings; run alone with --nocapture"]
fn profile_analysis() {
    // Keep this a runtime guard so the ignored diagnostic still compiles in
    // ordinary debug test suites, without permitting debug timing claims.
    assert!(!black_box(cfg!(debug_assertions)), "use cargo test --release");
    let runs = std::env::var("HERON_ANALYSIS_PROFILE_RUNS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(4);
    for (name, fft_size, model_order, excitation) in [
        ("default-sweep", 16384, 5, "sweep"),
        ("high-quality-random", 65536, 7, "random"),
    ] {
        let settings = PluginAnalysisSettings {
            fft_size,
            model_order,
            linear_excitation: excitation.into(),
            ..PluginAnalysisSettings::default()
        };
        for run in 0..runs {
            MEASUREMENT.with_borrow_mut(|current| {
                *current = Some(Measurement {
                    current: "preparing",
                    since: Instant::now(),
                    stages: BTreeMap::new(),
                    captures: 0,
                    frames: 0,
                    capture_time: Duration::ZERO,
                });
            });
            let started = Instant::now();
            let report = worker::analyze(
                Chain {
                    processors: Vec::new(),
                    comparison_processors: None,
                    settings: settings.clone(),
                    cancel: Arc::new(AtomicBool::new(false)),
                    clock: 0,
                    times: Vec::new(),
                },
                0,
                &Mutex::new(PluginAnalysisJobStatus::Running {
                    phase: "preparing".into(),
                    progress: 0.0,
                }),
            )
            .unwrap();
            let total = started.elapsed();
            stage("finished");
            let measurement = MEASUREMENT.with_borrow_mut(Option::take).unwrap();
            println!(
                "analysis_profile scenario={name} run={run} total_ms={:.3} capture_ms={:.3} captures={} frames={}",
                total.as_secs_f64() * 1000.0,
                measurement.capture_time.as_secs_f64() * 1000.0,
                measurement.captures,
                measurement.frames,
            );
            for (stage, duration) in measurement.stages {
                println!(
                    "analysis_profile scenario={name} run={run} stage={stage} ms={:.3}",
                    duration.as_secs_f64() * 1000.0,
                );
            }
            black_box(report);
        }
    }
}
