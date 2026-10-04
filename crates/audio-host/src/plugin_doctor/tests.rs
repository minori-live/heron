use super::{Chain, DoctorJobs, model, signal};
use heron_audio_plugin::{
    AudioPluginProcessor, AudioPluginProcessorHandle, ProcessContext, SidechainSource,
};
use heron_dsp_runtime::protocol::{DoctorFailure, DoctorJobStatus, DoctorSettings};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

fn settings() -> DoctorSettings {
    DoctorSettings {
        sample_rate: 48000,
        block_size: 256,
        level_dbfs: 6.0,
        start_hz: 20.0,
        end_hz: 20000.0,
        sweep_seconds: 1.0,
        tail_seconds: 0.25,
    }
}

#[test]
fn sweep_preserves_positive_dbfs_and_calibrates_gain() {
    let settings = settings();
    let input = signal::sweep(&settings);
    assert!(input.iter().any(|v| v.abs() > 1.9));
    let mut output: Vec<_> = input.iter().map(|v| v * 0.5).collect();
    output.resize(output.len() + 12000, 0.0);
    let measured = signal::response(&input, &output, &settings, 0, 0);
    for value in measured.magnitude_db {
        assert!((value + 6.0206).abs() < 0.01, "gain={value}");
    }
    assert_eq!(measured.delay_samples, Some(0));
    assert!(!measured.tail_truncated);
}

#[test]
fn sweep_measures_delay_and_cross_channel_response() {
    let settings = settings();
    let input = signal::sweep(&settings);
    let mut output = vec![0.0; 173];
    output.extend(input.iter().map(|v| v * 0.25));
    output.resize(input.len() + 12000, 0.0);
    let measured = signal::response(&input, &output, &settings, 0, 1);
    assert_eq!((measured.input, measured.output), (0, 1));
    assert_eq!(measured.delay_samples, Some(173));
    // Band-limited measurement and a finite causal IR window have edge error.
    let index = measured
        .frequency_hz
        .iter()
        .position(|f| *f >= 1000.0)
        .unwrap();
    assert!(
        (measured.magnitude_db[index] + 12.0412).abs() < 0.05,
        "gain={}",
        measured.magnitude_db[index]
    );
    let phase = measured.phase_degrees[index].unwrap();
    let compensated = phase + 360.0 * measured.frequency_hz[index] * 173.0 / 48000.0;
    assert!(compensated.abs() < 0.5, "phase={compensated}");
}

#[test]
fn hammerstein_recovers_a_polynomial_followed_by_filtering() {
    let input = signal::noise(32768, 0x34567, 2.0);
    let validation = signal::noise(16384, 0x56789, 2.0);
    let render = |input: &[f64]| {
        let nonlinear: Vec<_> = input
            .iter()
            .map(|x| x + 0.3 * x.powi(2) - 0.15 * x.powi(3))
            .collect();
        signal::convolve(&nonlinear, &[0.7, 0.2, 0.1])
    };
    let report = model::fit(
        model::FitData {
            channel: 0,
            input: &input,
            output: &render(&input),
            validation_input: &validation,
            validation_output: &render(&validation),
            scale: 2.0,
            delay: 0,
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    assert!(report.suitable, "error={}", report.validation_error_percent);
    assert!(
        report.validation_error_percent < 2.0,
        "error={}",
        report.validation_error_percent
    );
    assert!((report.coefficients[0] - 1.0).abs() < 0.001);
}

#[derive(Clone)]
struct Square;
impl AudioPluginProcessor for Square {
    fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
        Box::new(self.clone())
    }
    fn process_block(
        &mut self,
        frames: &mut [[f32; 2]],
        _: &dyn SidechainSource,
        _: &ProcessContext,
    ) -> bool {
        for frame in frames {
            for value in frame {
                *value += 0.5 * *value * *value;
            }
        }
        true
    }
}

#[test]
fn stable_sines_measure_the_second_harmonic_without_clamping_input() {
    let mut settings = settings();
    settings.start_hz = 100.0;
    settings.end_hz = 1000.0;
    let mut chain = Chain {
        processors: vec![AudioPluginProcessorHandle::new(Square)],
        settings,
        cancel: Arc::new(AtomicBool::new(false)),
        clock: 0,
        times: Vec::new(),
    };
    let report = chain.harmonics(0).unwrap();
    // x + 0.5*x² has H2/H1 = 0.25*A, here A = 10^(6/20).
    let expected = 20.0 * (0.25 * 10_f64.powf(6.0 / 20.0)).log10();
    for value in &report.orders_db[0] {
        assert!((value.unwrap() - expected).abs() < 0.01);
    }
    assert!(
        !report.orders_db[6]
            .iter()
            .any(|v| v.is_some_and(|v| v > -100.0))
    );
}

#[test]
fn cancellation_is_observed_before_entering_a_processor() {
    let mut chain = Chain {
        processors: vec![AudioPluginProcessorHandle::new(Square)],
        settings: settings(),
        cancel: Arc::new(AtomicBool::new(true)),
        clock: 0,
        times: Vec::new(),
    };
    assert_eq!(
        chain.capture(&[2.0], 0, 0, true),
        Err(DoctorFailure::Cancelled)
    );
    assert!(chain.times.is_empty());
}

#[derive(Clone)]
struct Retiring(Arc<AtomicUsize>);
impl AudioPluginProcessor for Retiring {
    fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
        Box::new(self.clone())
    }
    fn retire(&mut self) {
        self.0.fetch_add(1, Ordering::AcqRel);
    }
    fn process_block(
        &mut self,
        _: &mut [[f32; 2]],
        _: &dyn SidechainSource,
        _: &ProcessContext,
    ) -> bool {
        true
    }
}

#[test]
fn runtime_teardown_cancels_and_joins_the_measurement_owner() {
    let retired = Arc::new(AtomicUsize::new(0));
    let jobs = DoctorJobs::default();
    assert!(matches!(
        jobs.start(
            "owned".into(),
            vec![AudioPluginProcessorHandle::new(Retiring(Arc::clone(
                &retired
            )))],
            settings(),
            0
        ),
        DoctorJobStatus::Running { .. }
    ));
    assert_eq!(
        jobs.start("other".into(), vec![], settings(), 0),
        DoctorJobStatus::Failed {
            failure: DoctorFailure::Busy
        }
    );
    drop(jobs);
    assert_eq!(retired.load(Ordering::Acquire), 1);
}

#[derive(Clone)]
struct InvalidOutput;
impl AudioPluginProcessor for InvalidOutput {
    fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
        Box::new(self.clone())
    }
    fn process_block(
        &mut self,
        frames: &mut [[f32; 2]],
        _: &dyn SidechainSource,
        _: &ProcessContext,
    ) -> bool {
        frames[0][0] = f32::NAN;
        true
    }
}

#[test]
fn invalid_samples_produce_a_typed_failure_instead_of_a_report() {
    let mut chain = Chain {
        processors: vec![AudioPluginProcessorHandle::new(InvalidOutput)],
        settings: settings(),
        cancel: Arc::new(AtomicBool::new(false)),
        clock: 0,
        times: Vec::new(),
    };
    assert_eq!(
        chain.capture(&[2.0], 0, 0, true),
        Err(DoctorFailure::InvalidOutput)
    );
}
