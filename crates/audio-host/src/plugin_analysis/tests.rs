use super::{Chain, PluginAnalysisJobs, model, signal, spectrogram};
use heron_audio_plugin::{
    AudioPluginProcessor, AudioPluginProcessorHandle, ProcessContext, SidechainSource,
};
use heron_dsp_runtime::protocol::{
    PluginAnalysisFailure, PluginAnalysisJobStatus, PluginAnalysisSettings,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

fn settings() -> PluginAnalysisSettings {
    PluginAnalysisSettings {
        sample_rate: 48000,
        block_size: 256,
        level_dbfs: 6.0,
        start_hz: 20.0,
        end_hz: 20000.0,
        sweep_seconds: 1.0,
        tail_seconds: 0.25,
        tone_hz: 1000.0,
        model_order: 5,
        mid_side: false,
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
fn long_unity_delay_preserves_magnitude_and_compensated_phase() {
    let settings = settings();
    let input = signal::sweep(&settings);
    // 125 ms of delay stays inside the 250 ms tail but rotates neighbouring FFT
    // bins far enough to cancel an interpolation that ignores the delay phase.
    let delay = 6000usize;
    let mut output = vec![0.0; delay];
    output.extend_from_slice(&input);
    output.resize(input.len() + 12000, 0.0);
    let measured = signal::response(&input, &output, &settings, 0, 0);
    assert_eq!(measured.delay_samples, Some(delay as u32));
    let index = measured
        .frequency_hz
        .iter()
        .position(|f| *f >= 1000.0)
        .unwrap();
    assert!(
        measured.magnitude_db[index].abs() < 0.05,
        "gain={}",
        measured.magnitude_db[index]
    );
    let phase = measured.phase_degrees[index].unwrap();
    let compensated = phase + 360.0 * measured.frequency_hz[index] * delay as f64 / 48000.0;
    assert!(compensated.abs() < 0.5, "phase={compensated}");
}

#[test]
fn spectrogram_reports_a_constant_output_at_zero_dbfs() {
    let settings = settings();
    let frames = (settings.sweep_seconds * f64::from(settings.sample_rate)) as usize;
    let output = vec![1.0; frames];
    let measured =
        spectrogram::measure(&output, &settings, 0, false, &AtomicBool::new(false)).unwrap();
    // A full window in the middle of the sweep sees a constant 1.0. Its DC band
    // must not carry the one-sided factor of two.
    let column = 96usize;
    let dc = measured.magnitude_dbfs[column * measured.rows as usize];
    assert!(dc.abs() < 0.1, "dc={dc}");
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
            order: 5,
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

#[test]
fn hammerstein_honours_the_requested_order() {
    let input = signal::noise(16384, 0x12345, 2.0);
    let validation = signal::noise(8192, 0x23456, 2.0);
    let render = |input: &[f64]| {
        let nonlinear: Vec<_> = input.iter().map(|x| x + 0.3 * x.powi(2)).collect();
        signal::convolve(&nonlinear, &[0.7, 0.2, 0.1])
    };
    for order in [3u32, 7] {
        let report = model::fit(
            model::FitData {
                channel: 0,
                input: &input,
                output: &render(&input),
                validation_input: &validation,
                validation_output: &render(&validation),
                scale: 2.0,
                delay: 0,
                order,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(report.coefficients.len(), order as usize);
        assert!(report.suitable, "order={order}");
    }
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
    let report = chain.harmonics(super::StereoRoute::Channel(0)).unwrap();
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
fn single_tone_distortion_matches_a_quadratic_nonlinearity() {
    let mut settings = settings();
    settings.tone_hz = 1000.0;
    let mut chain = Chain {
        processors: vec![AudioPluginProcessorHandle::new(Square)],
        settings,
        cancel: Arc::new(AtomicBool::new(false)),
        clock: 0,
        times: Vec::new(),
    };
    let report = chain.distortion(super::StereoRoute::Channel(0)).unwrap();
    // x + 0.5*x² fed A·sin has H2/H1 = 0.25·A with A = 10^(6/20).
    let expected = 0.25 * 10_f64.powf(6.0 / 20.0) * 100.0;
    let thd = report.thd_percent.unwrap();
    assert!((thd - expected).abs() < 0.05, "thd={thd}");
    assert!(report.thd_plus_n_percent.unwrap() >= thd);
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
        Err(PluginAnalysisFailure::Cancelled)
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
    let jobs = PluginAnalysisJobs::default();
    assert!(matches!(
        jobs.start(
            "owned".into(),
            vec![AudioPluginProcessorHandle::new(Retiring(Arc::clone(
                &retired
            )))],
            settings(),
            0
        ),
        PluginAnalysisJobStatus::Running { .. }
    ));
    assert_eq!(
        jobs.start("other".into(), vec![], settings(), 0),
        PluginAnalysisJobStatus::Failed {
            failure: PluginAnalysisFailure::Busy
        }
    );
    drop(jobs);
    assert_eq!(retired.load(Ordering::Acquire), 1);
}

#[derive(Clone)]
struct InvertRight;
impl AudioPluginProcessor for InvertRight {
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
            frame[1] = -frame[1];
        }
        true
    }
}

#[test]
fn mid_side_routing_folds_stereo_outputs() {
    let mut chain = Chain {
        processors: vec![AudioPluginProcessorHandle::new(InvertRight)],
        settings: settings(),
        cancel: Arc::new(AtomicBool::new(false)),
        clock: 0,
        times: Vec::new(),
    };
    let input = [1.0, -1.0, 1.0, -1.0];
    // Mid drives both channels in phase; the inverted right channel cancels it.
    let mid = chain
        .capture_route(&input, super::StereoRoute::Mid, 0, false)
        .unwrap();
    assert!(
        mid.iter()
            .all(|frame| super::StereoRoute::Mid.measure(*frame).abs() < 1e-9)
    );
    assert!(
        mid.iter()
            .any(|frame| super::StereoRoute::Side.measure(*frame).abs() > 0.5)
    );
    // Side drives the channels out of phase; the inverted right channel sums in.
    let side = chain
        .capture_route(&input, super::StereoRoute::Side, 0, false)
        .unwrap();
    assert!(
        side.iter()
            .any(|frame| super::StereoRoute::Mid.measure(*frame).abs() > 0.5)
    );
    assert!(
        side.iter()
            .all(|frame| super::StereoRoute::Side.measure(*frame).abs() < 1e-9)
    );
}

#[test]
fn oscilloscope_captures_the_standard_waveforms() {
    let mut chain = Chain {
        processors: Vec::new(),
        settings: settings(),
        cancel: Arc::new(AtomicBool::new(false)),
        clock: 0,
        times: Vec::new(),
    };
    let scope = chain
        .oscilloscope(super::StereoRoute::Channel(0), 7)
        .unwrap();
    assert_eq!(scope.delay_samples, 7);
    assert_eq!(scope.waveforms.len(), 4);
    for waveform in &scope.waveforms {
        assert_eq!(waveform.input.len(), waveform.output.len());
        assert!(waveform.output.iter().any(|value| value.abs() > 0.5));
        // A transparent chain returns the excitation unchanged.
        assert!(
            waveform
                .input
                .iter()
                .zip(&waveform.output)
                .all(|(a, b)| (a - b).abs() < 1e-3)
        );
    }
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
        Err(PluginAnalysisFailure::InvalidOutput)
    );
}
