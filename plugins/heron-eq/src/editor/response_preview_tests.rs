use super::*;
use crate::params::EqParams;
use heron_dsp_core::eq::{BRICKWALL_SLOPE, EqBand, EqChannel, EqShape, LinearPhaseResolution};
use std::time::{Duration, Instant};

fn ready(
    preview: &mut ResponsePreview,
    config: &EqConfig,
    extras: Extras,
    rate: f64,
) -> Projection {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let projection = preview.project(config, extras, rate, 0.0, false, true);
        if projection.prepared.is_some() || projection.failed {
            assert!(!projection.failed);
            return projection;
        }
        assert!(
            Instant::now() < deadline,
            "finite FIR preview did not complete"
        );
        thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn paused_audio_add_and_edit_preview_current_bands_in_every_native_mode() {
    let params = EqParams::default();
    assert_eq!(params.telemetry.sequence(), 0);
    assert!(params.telemetry.active_config().is_none());
    let stale = EqConfig::default();
    params.telemetry.publish_active_config_rt(&stale);
    for mode in [
        ProcessingMode::ZeroLatency,
        ProcessingMode::NaturalPhase,
        ProcessingMode::LinearPhase,
    ] {
        let mut preview = ResponsePreview::default();
        let mut config = EqConfig {
            processing_mode: mode,
            linear_phase_resolution: LinearPhaseResolution::Low,
            ..EqConfig::default()
        };
        let empty = preview.project(&config, Extras::default(), 48000.0, 0.0, false, true);
        assert!(empty.show_total_response);
        config.bands.push(EqBand {
            id: 1,
            frequency_hz: 1500.0,
            gain_db: 6.0,
            ..EqBand::default()
        });
        let added = preview.project(&config, Extras::default(), 48000.0, 0.0, false, true);
        assert_eq!(added.config.bands[0].gain_db, 6.0);
        assert!(added.show_total_response);
        config.bands[0].frequency_hz = 3000.0;
        config.bands[0].gain_db = -9.0;
        let edited = preview.project(&config, Extras::default(), 48000.0, 0.0, false, true);
        assert_eq!(edited.config.bands[0].frequency_hz, 3000.0);
        assert_eq!(edited.config.bands[0].gain_db, -9.0);
        if mode == ProcessingMode::LinearPhase {
            let finished = ready(&mut preview, &config, Extras::default(), 48000.0);
            let processor = EqProcessor::prepare(&config, 48000.0).unwrap();
            let response = finished.prepared.unwrap();
            for index in [70, 150, 210] {
                assert_eq!(
                    response.matrix[index],
                    processor.response_matrix(response.frequency_hz[index])
                );
            }
        } else {
            let expected = EqProcessor::prepare(&config, 48000.0).unwrap();
            assert_eq!(
                edited.config.response_matrix(48000.0, 3000.0),
                expected.response_matrix(3000.0)
            );
            assert!(!edited.pending);
        }
    }
    assert_eq!(params.telemetry.sequence(), 0);
    assert_eq!(params.telemetry.active_config().unwrap(), stale);
}

#[test]
fn preview_globals_are_current_and_unknown_rate_has_a_defined_native_fallback() {
    let mut preview = ResponsePreview::default();
    let config = EqConfig {
        bands: vec![EqBand {
            id: 1,
            frequency_hz: 30000.0,
            gain_db: 24.0,
            ..EqBand::default()
        }],
        output_gain_db: 3.0,
        processing_mode: ProcessingMode::NaturalPhase,
        ..EqConfig::default()
    };
    let extras = Extras {
        gain_scale: 2.0,
        auto_gain: true,
        phase_invert: true,
        output_pan: 1.0,
        ..Extras::default()
    };
    let projection = preview.project(&config, extras, f64::NAN, -2.0, false, true);
    assert_eq!(projection.sample_rate, 44100.0);
    assert_eq!(projection.config.bands[0].frequency_hz, 44100.0 * 0.498);
    assert_eq!(projection.config.bands[0].gain_db, 36.0);
    assert_eq!(projection.config.output_gain_db, 1.0);
    assert_eq!(projection.pan, [[0.0, 0.0], [0.0, 1.0]]);
    let mono = preview.project(&config, extras, 48000.0, -2.0, false, false);
    assert_eq!(mono.pan, [[1.0, 0.0], [0.0, 1.0]]);
    let mut bypass = config.clone();
    bypass.bypass = true;
    let bypassed = preview.project(&bypass, extras, 48000.0, -2.0, true, true);
    assert!(bypassed.config.bypass && bypassed.show_total_response);
    assert!(
        bypassed
            .config
            .magnitude_db(48000.0, 1500.0, EqChannel::Stereo)
            .abs()
            < 1.0e-10
    );
}

#[test]
fn finite_fir_latest_target_replaces_old_grid_and_scalar_edits_reuse_matching_kernel() {
    let mut preview = ResponsePreview::default();
    let mut config = EqConfig {
        bands: vec![EqBand {
            id: 1,
            shape: EqShape::HighCut,
            frequency_hz: 1000.0,
            slope_db_oct: BRICKWALL_SLOPE,
            ..EqBand::default()
        }],
        processing_mode: ProcessingMode::LinearPhase,
        linear_phase_resolution: LinearPhaseResolution::Low,
        ..EqConfig::default()
    };
    let previous = ready(&mut preview, &config, Extras::default(), 48000.0);
    let previous = previous.prepared.unwrap();
    for frequency in [2000.0, 6000.0, 2500.0, 4000.0] {
        config.bands[0].frequency_hz = frequency;
        let next = preview.project(&config, Extras::default(), 48000.0, 0.0, false, true);
        if let Some(response) = next.prepared {
            assert_ne!(response.generation, previous.generation);
        }
    }
    let finished = ready(&mut preview, &config, Extras::default(), 48000.0);
    let observed_revision = finished.revision;
    let response = finished.prepared.unwrap();
    let processor = EqProcessor::prepare(&config, 48000.0).unwrap();
    let index = response
        .frequency_hz
        .partition_point(|frequency| *frequency < 4000.0);
    assert_eq!(
        response.matrix[index],
        processor.response_matrix(response.frequency_hz[index])
    );
    let edge_db = response.matrix[index].magnitude_db(EqChannel::Stereo);
    assert!(
        (-90.0..-1.0).contains(&edge_db),
        "finite cut transition {edge_db}"
    );
    config.output_gain_db = -6.0;
    let extras = Extras {
        output_pan: -1.0,
        output_pan_mode: 1,
        ..Extras::default()
    };
    let scalar = preview.project(&config, extras, 48000.0, 0.0, false, true);
    assert!(Arc::ptr_eq(scalar.prepared.as_ref().unwrap(), &response));
    assert_eq!(scalar.config.output_gain_db, -6.0);
    assert_eq!(scalar.pan, [[0.5, 0.5], [0.5, 0.5]]);
    assert_eq!(scalar.revision, observed_revision);
    assert!(!scalar.pending);
    assert_eq!(preview.revision(), observed_revision);
}

#[test]
fn closing_preview_reclaims_its_worker_before_native_plugin_unload() {
    let mut preview = ResponsePreview::default();
    assert!(preview.worker.is_some());
    let shared = Arc::clone(&preview.shared);
    let config = EqConfig {
        processing_mode: ProcessingMode::LinearPhase,
        linear_phase_resolution: LinearPhaseResolution::Low,
        bands: vec![EqBand {
            gain_db: 9.0,
            ..EqBand::default()
        }],
        ..EqConfig::default()
    };
    preview.project(&config, Extras::default(), 48000.0, 0.0, false, true);
    drop(preview);
    // The worker's captured Arc is gone before Drop returns, whether it was
    // waiting for work or already evaluating the queued FIR design.
    assert_eq!(Arc::strong_count(&shared), 1);
    assert!(shared.stop.load(Ordering::Acquire));
}
