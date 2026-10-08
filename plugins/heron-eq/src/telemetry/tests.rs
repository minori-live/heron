use super::*;
const FFT_SIZE: usize = 4096;
#[test]
fn spectrum_measures_real_pre_post_and_antiphase_stereo() {
    let telemetry = EqTelemetry::default();
    telemetry.set_sample_rate(48000.0);
    for index in 0..FFT_SIZE {
        let input = (std::f32::consts::TAU * 1000.0 * index as f32 / 48000.0).sin() * 0.5;
        telemetry.capture([input, -input], [input * 0.5, -input * 0.5], [0.0; 2]);
    }
    let snapshot = telemetry.spectrum();
    let peak = snapshot
        .pre_db
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
        .unwrap()
        .0;
    assert!((snapshot.frequency_hz[peak] - 1000.0).abs() < 30.0);
    assert!(snapshot.pre_db[peak] > -8.0);
    assert!((snapshot.post_db[peak] - snapshot.pre_db[peak] + 6.0206).abs() < 0.01);
    assert_eq!(snapshot.external_db[peak], -120.0);
}

#[test]
fn sample_rate_boundary_never_returns_old_grid_or_mixed_rate_fft_window() {
    let telemetry = EqTelemetry::default();
    telemetry.set_sample_rate(48000.0);
    for index in 0..FFT_SIZE {
        let sample = (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.5;
        telemetry.capture([sample; 2], [sample; 2], [0.0; 2]);
    }
    assert!(!telemetry.spectrum().frequency_hz.is_empty());
    telemetry.set_sample_rate(96000.0);
    for _ in 0..FFT_SIZE - 1 {
        telemetry.capture([0.0; 2], [0.0; 2], [0.0; 2]);
    }
    let waiting = telemetry.spectrum();
    assert_eq!(waiting.sample_rate, 96000.0);
    assert!(waiting.frequency_hz.is_empty());
    for index in 0..FFT_SIZE {
        let sample = (std::f32::consts::TAU * 3000.0 * index as f32 / 96000.0).sin() * 0.25;
        telemetry.capture([sample; 2], [sample; 2], [0.0; 2]);
    }
    let current = telemetry.spectrum();
    let peak = current
        .pre_db
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
        .unwrap()
        .0;
    assert!((current.frequency_hz[peak] - 3000.0).abs() < 60.0);
    assert!((current.pre_db[peak] + 12.0412).abs() < 0.01);
}

#[test]
fn local_freeze_keeps_raw_measurement_separate_from_display_projection() {
    let telemetry = EqTelemetry::default();
    telemetry.set_sample_rate(48000.0);
    let own_config = AnalyzerConfig {
        channel: heron_dsp_core::eq::EqChannel::Side,
        tilt_db_oct: 6.0,
        ..AnalyzerConfig::default()
    };
    telemetry.set_analyzer(own_config).unwrap();
    for index in 0..FFT_SIZE {
        let input = (std::f32::consts::TAU * 1000.0 * index as f32 / 48000.0).sin() * 0.5;
        telemetry.capture([input; 2], [input * 0.5; 2], [input * 0.25; 2]);
    }
    let (raw, display) = telemetry.spectrum_pair();
    let peak = raw
        .pre_db
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
        .unwrap()
        .0;
    assert!(raw.pre_db[peak] > -8.0, "raw retains the stereo tone");
    assert!((raw.post_db[peak] - raw.pre_db[peak] + 6.0206).abs() < 0.01);
    assert!((raw.external_db[peak] - raw.pre_db[peak] + 12.0412).abs() < 0.01);
    assert!(display.pre_db[peak] < -110.0, "Side display stays silent");
    assert!(display.post_db[peak] < -110.0);
    assert!(display.external_db[peak] < -110.0);
    assert_eq!(raw.pre_db, telemetry.spectrum().pre_db);
    assert_eq!(display.pre_db, telemetry.display_spectrum().pre_db);
    assert_eq!(telemetry.analyzer_config(), own_config);
    assert_eq!(raw.sequence, FFT_SIZE as u64);
    assert_eq!(display.sequence, raw.sequence);
    assert_eq!(display.sample_rate, raw.sample_rate);
    assert_eq!(display.frequency_hz, raw.frequency_hz);
    assert_eq!(display.age_samples, raw.age_samples);
    assert_eq!(display.input_peak, raw.input_peak);
    assert_eq!(display.output_peak, raw.output_peak);
}

#[test]
fn prepared_matrix_transport_keeps_all_four_actual_complex_channel_transfers() {
    use heron_dsp_core::eq::{
        EqBand, EqChannel, EqConfig, EqProcessor, LinearPhaseResolution, ProcessingMode,
    };
    let config = EqConfig {
        bands: vec![
            EqBand {
                id: 1,
                channel: EqChannel::Mid,
                gain_db: 12.0,
                ..EqBand::default()
            },
            EqBand {
                id: 2,
                channel: EqChannel::Left,
                gain_db: -6.0,
                frequency_hz: 3000.0,
                ..EqBand::default()
            },
        ],
        processing_mode: ProcessingMode::LinearPhase,
        linear_phase_resolution: LinearPhaseResolution::Low,
        ..EqConfig::default()
    };
    let processor = EqProcessor::prepare(&config, 48000.0).unwrap();
    let response = crate::response::prepare_response(&processor, 48000.0, 84);
    let telemetry = EqTelemetry::default();
    truce_test::assert_realtime_clean(|| {
        let _section = truce::rt::RtSection::enter();
        telemetry.publish_active_response_rt(&response);
    });
    let restored = telemetry.prepared_response().unwrap();
    assert_eq!(restored.generation, 84);
    assert_eq!(restored.matrix, response.matrix);
    let pan = crate::output_pan::OutputPan::new(48000.0, 0.5, 1, true).matrix();
    for index in 0..crate::response::RESPONSE_POINTS {
        let actual = crate::output_pan::apply_response_matrix(
            processor.response_matrix(restored.frequency_hz[index]),
            pan,
        );
        assert_eq!(
            crate::output_pan::apply_response_matrix(restored.matrix[index], pan),
            actual
        );
    }
}
