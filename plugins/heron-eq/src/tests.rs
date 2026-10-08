use super::*;
use std::time::Duration;
use truce_test::{InputSource, assert_realtime_clean, assertions, driver};

#[test]
fn neutral_equalizer_preserves_real_audio_without_callback_allocation() {
    let output = assert_realtime_clean(|| {
        driver!(Plugin)
            .duration(Duration::from_millis(15))
            .input(InputSource::Constant(0.25))
            .run()
    });
    for channel in output.output {
        assert!(
            channel
                .iter()
                .all(|sample| sample.to_bits() == 0.25f32.to_bits())
        );
    }
}

#[test]
fn stable_band_slots_recall_present_and_bypass_independently() {
    let params = EqParams::default();
    let infos = EqParams::param_infos_static();
    assert_eq!(infos.len(), 10 + 24 * 9);
    for id in 0..=10 {
        assert_eq!(infos.iter().any(|info| info.id == id), id != 6);
    }
    for slot in 0..24 {
        let base = params::BAND_BASE + slot * params::BAND_STRIDE;
        for offset in 0..params::BAND_STRIDE {
            let present = infos.iter().any(|info| info.id == base + offset);
            assert_eq!(
                present,
                matches!(offset, 0..=7 | 19),
                "slot {slot}, offset {offset}"
            );
        }
    }
    params.set_plain(100, 1.0);
    params.set_plain(101, 0.0);
    params.set_plain(103, 1600.0);
    params.set_plain(836, 1.0);
    params.set_plain(840, -9.0);
    let snapshot = params.snapshot();
    assert_eq!(snapshot.bands.len(), 2);
    assert_eq!(snapshot.bands[0].id, 1);
    assert!(!snapshot.bands[0].enabled);
    assert_eq!(snapshot.bands[1].id, 24);
    assert_eq!(snapshot.bands[1].gain_db, -9.0);
    let restored = EqParams::default();
    for (id, value) in params::normalized_values(&snapshot) {
        restored.set_normalized(id, value);
    }
    let recalled = restored.snapshot();
    assert_eq!(recalled.bands.len(), snapshot.bands.len());
    for (recalled, original) in recalled.bands.iter().zip(&snapshot.bands) {
        assert_eq!(recalled.id, original.id);
        assert_eq!(recalled.enabled, original.enabled);
        assert!((recalled.frequency_hz - original.frequency_hz).abs() < 1.0e-8);
        assert!((recalled.gain_db - original.gain_db).abs() < 1.0e-8);
    }
}

#[test]
fn portable_fit_and_legacy_extra_fields_restore_only_the_static_configuration() {
    use heron_dsp_core::eq::EqConfig;
    let portable: serde_json::Value =
        serde_json::from_str(include_str!("../tests/fixtures/fit-preset.json")).unwrap();
    let expected: EqConfig = serde_json::from_value(portable["config"].clone()).unwrap();
    let mut legacy = portable["config"].clone();
    legacy["bands"][0]["dynamic"] = serde_json::json!({
        "enabled": true,
        "range_db": -36.0,
        "external_sidechain": true,
        "spectral": true
    });
    let restored: EqConfig = serde_json::from_value(legacy).unwrap();
    assert_eq!(restored, expected);
    assert!(
        !serde_json::to_string(&restored)
            .unwrap()
            .contains("dynamic")
    );
    let params = EqParams::default();
    for (id, value) in params::normalized_values(&restored) {
        params.set_normalized(id, value);
    }
    let accepted = params.snapshot();
    let atomic = crate::atomic_config::AtomicConfig::default();
    atomic.publish(&accepted, true);
    assert_eq!(atomic.read().unwrap().1, accepted);
}

#[test]
fn active_bands_and_parameter_transitions_are_finite_and_allocation_free() {
    let output = assert_realtime_clean(|| {
        driver!(Plugin)
            .duration(Duration::from_millis(50))
            .input(InputSource::Constant(0.25))
            .script(|script| {
                script.set_param(100u32, 1.0);
                script.set_param(104u32, 12.0);

                script.wait_ms(15);

                script.set_param(104u32, -9.0);
            })
            .run()
    });
    assertions::assert_no_nans(&output);
}

fn render_block(
    state: &mut EqDspState,
    params: &EqParams,
    input: &[f32],
    events: &EventList,
) -> Vec<f32> {
    let mut left = vec![0.0; input.len()];
    let mut right = vec![0.0; input.len()];
    let inputs = [input, input];
    let mut outputs = [left.as_mut_slice(), right.as_mut_slice()];
    let mut buffer = AudioBuffer::from_slices_checked(&inputs, &mut outputs, input.len());
    assert_realtime_clean(|| {
        let _section = truce::rt::RtSection::enter();
        state.process(params, &mut buffer, events);
    });
    left
}

#[test]
fn retired_output_slot_does_not_retarget_saved_static_controls() {
    let restored = EqParams::default();
    let reference = EqParams::default();
    // Keyed host state from the previous schema can contain the retired slot
    // between surviving controls. Values after that slot keep their identities.
    let values = [
        (0, 6.0),
        (6, 2.0),
        (7, 0.0),
        (8, 0.5),
        (9, 1.0),
        (840, 18.0),
    ];
    restored.restore_values(&values);
    reference.restore_values(
        &values
            .into_iter()
            .filter(|(id, _)| *id != 6)
            .collect::<Vec<_>>(),
    );
    assert_eq!(restored.get_normalized(6), None);
    for info in EqParams::param_infos_static() {
        assert_eq!(
            restored.get_normalized(info.id),
            reference.get_normalized(info.id)
        );
    }
    assert_eq!(restored.output_pan_mode.value(), 1);
    assert_eq!(restored.linear_phase_resolution.value(), 0);
    assert_eq!(restored.band24.gain.raw_target(), 18.0);
}

#[test]
fn native_equalizer_preserves_signal_linearity_and_headroom_in_every_processing_mode() {
    let first: Vec<_> = (0..8192)
        .map(|index| (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.6)
        .collect();
    let second: Vec<_> = (0..first.len())
        .map(|index| (std::f32::consts::TAU * 4200.0 * index as f32 / 48000.0).sin() * 0.4)
        .collect();
    let doubled: Vec<_> = first.iter().map(|sample| sample * 2.0).collect();
    let combined: Vec<_> = first.iter().zip(&second).map(|(a, b)| a + b).collect();
    let events = EventList::with_capacity(0);
    for mode in 0..3 {
        let params = EqParams::default();
        params.processing_mode.set_value(mode);
        params.linear_phase_resolution.set_value(0);
        params.band01.present.set_value(true);
        params.band01.frequency.set_value(1500.0);
        params.band01.gain.set_value(12.0);
        params.band01.channel.set_value(1);
        params.output_gain.set_value(6.0);
        params.phase_invert.set_value(true);
        params.output_pan.set_value(0.2);
        params.output_pan_mode.set_value(1);
        // Restoring the old maximum-color value must not add a nonlinear stage.
        params.restore_values(&[(6, 2.0)]);
        let render = |input: &[f32]| {
            let mut state = EqDspState::default();
            state.reset(&params, 48000.0);
            render_block(&mut state, &params, input, &events)
        };
        let a = render(&first);
        let b = render(&second);
        let two_a = render(&doubled);
        let sum = render(&combined);
        assert!(two_a.iter().any(|sample| sample.abs() > 1.0));
        for index in 0..first.len() {
            let tolerance = 2.0e-5 * (a[index].abs() + b[index].abs()).max(1.0);
            assert!(
                (two_a[index] - 2.0 * a[index]).abs() < tolerance,
                "mode {mode}: scaling"
            );
            assert!(
                (sum[index] - a[index] - b[index]).abs() < tolerance,
                "mode {mode}: superposition"
            );
        }
    }
}

#[test]
fn learned_midi_controller_obeys_its_sample_offset_within_audio_block() {
    let params = EqParams::default();
    params.midi_bindings.bind(74, 4);
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    let mut events = EventList::with_capacity(1);
    events.push(Event::new(
        64,
        EventBody::ControlChange {
            group: 0,
            channel: 0,
            cc: 74,
            value: 127,
        },
    ));
    let output = render_block(&mut state, &params, &[0.25; 128], &events);
    assert!(output[..64].iter().all(|sample| *sample == 0.25));
    assert!(output[64..].iter().all(|sample| *sample == -0.25));
}

#[test]
fn global_bypass_returns_full_chain_latency_aligned_dry_audio() {
    let params = EqParams::default();
    params.processing_mode.set_value(2);
    params.linear_phase_resolution.set_value(0);
    params.set_plain(100, 1.0);
    params.set_plain(104, 12.0);

    params.set_plain(0, 12.0);
    params.set_plain(4, 1.0);
    params.set_plain(5, 1.0);
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    let events = EventList::with_capacity(0);
    let input: Vec<_> = (0..16384)
        .map(|index| (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.5)
        .collect();
    render_block(&mut state, &params, &input[..8192], &events);
    assert_eq!(state.latency_samples(), 512);
    params.bypass.set_value(true);
    let output = render_block(&mut state, &params, &input[8192..], &events);
    assert_eq!(state.latency_samples(), 512);
    for index in 4096..8192 {
        assert!((output[index] - input[8192 + index - 512]).abs() < 1.0e-6);
    }
}

#[test]
fn accepted_iir_audio_and_curve_update_together_and_invalid_update_retains_both() {
    let params = EqParams::default();
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    params.set_plain(100, 1.0);
    params.set_plain(103, 1500.0);
    params.set_plain(104, 12.0);
    let input: Vec<_> = (0..8192)
        .map(|index| (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.1)
        .collect();
    let events = EventList::with_capacity(0);
    let output = render_block(&mut state, &params, &input, &events);
    let active = params
        .telemetry
        .active_config()
        .expect("published accepted core state");
    let predicted = active
        .response_matrix(48000.0, 1500.0)
        .magnitude_db(heron_dsp_core::eq::EqChannel::Stereo);
    let energy = |samples: &[f32]| {
        samples
            .iter()
            .map(|value| f64::from(*value).powi(2))
            .sum::<f64>()
    };
    let measured = 10.0 * (energy(&output[4096..]) / energy(&input[4096..])).log10();
    assert!((measured - predicted).abs() < 0.01);
    assert!((predicted - 12.0).abs() < 0.001);
    params.set_plain(106, 1000.0); // A brickwall Bell is an invalid request.
    let output = render_block(&mut state, &params, &input, &events);
    assert_eq!(params.telemetry.active_config().unwrap(), active);
    let measured = 10.0 * (energy(&output[4096..]) / energy(&input[4096..])).log10();
    assert!((measured - predicted).abs() < 0.01);
}

#[test]
fn overlapping_native_iir_edits_keep_audio_continuous_and_publish_promoted_target() {
    for mode in [0.0, 1.0] {
        let params = EqParams::default();
        let control_params = EqParams::default();
        for settings in [&params, &control_params] {
            settings.set_plain(2, mode);
            settings.set_plain(100, 1.0);
            settings.set_plain(102, 1.0); // Low Shelf.
            settings.set_plain(103, 2000.0);
            settings.set_plain(104, 12.0);
        }
        let mut state = EqDspState::default();
        let mut control = EqDspState::default();
        state.reset(&params, 48000.0);
        control.reset(&control_params, 48000.0);
        let events = EventList::with_capacity(0);
        let input = vec![0.1; 4000];
        render_block(&mut state, &params, &input, &events);
        render_block(&mut control, &control_params, &input, &events);
        params.set_plain(104, -12.0);
        control_params.set_plain(104, -12.0);
        assert_eq!(
            render_block(&mut state, &params, &input[..100], &events),
            render_block(&mut control, &control_params, &input[..100], &events)
        );
        params.set_plain(104, -6.0);
        assert_eq!(
            render_block(&mut state, &params, &input[..20], &events),
            render_block(&mut control, &control_params, &input[..20], &events)
        );
        assert!(params.telemetry.processing_pending());
        assert!((params.telemetry.active_config().unwrap().bands[0].gain_db + 12.0).abs() < 1.0e-8);
        params.set_plain(104, 3.0);
        let before = render_block(&mut state, &params, &input[..120], &events);
        assert_eq!(
            before,
            render_block(&mut control, &control_params, &input[..120], &events)
        );
        // No additional parameter event is sent after promotion within the
        // block: metadata must still advance to the actually installed target.
        assert!(!params.telemetry.processing_pending());
        assert!((params.telemetry.active_config().unwrap().bands[0].gain_db - 3.0).abs() < 1.0e-8);
        let after = render_block(&mut state, &params, &input[..3000], &events);
        assert!((after[0] - before[119]).abs() < 0.005);
        assert!((f64::from(after[2999]) - 0.1 * 10.0_f64.powf(3.0 / 20.0)).abs() < 1.0e-6);
    }
}

#[test]
fn native_parameter_roundtrip_preserves_mixed_projection_band_order_and_audio() {
    use heron_dsp_core::eq::{EqBand, EqChannel, EqConfig, EqProcessor, EqShape};
    let original = EqConfig {
        bands: vec![
            EqBand {
                id: 24,
                channel: EqChannel::Left,
                frequency_hz: 1500.0,
                gain_db: 12.0,
                ..EqBand::default()
            },
            EqBand {
                id: 1,
                channel: EqChannel::Mid,
                shape: EqShape::HighShelf,
                frequency_hz: 600.0,
                gain_db: -9.0,
                ..EqBand::default()
            },
            EqBand {
                id: 8,
                channel: EqChannel::Side,
                frequency_hz: 2200.0,
                gain_db: 6.0,
                ..EqBand::default()
            },
        ],
        ..EqConfig::default()
    };
    let params = EqParams::default();
    for (id, value) in params::normalized_values(&original) {
        params.set_normalized(id, value);
    }
    let recalled = params.snapshot();
    assert_eq!(
        recalled
            .bands
            .iter()
            .map(|band| band.id)
            .collect::<Vec<_>>(),
        [24, 1, 8]
    );
    let mut expected = EqProcessor::prepare(&original, 48000.0).unwrap();
    let mut actual = EqProcessor::prepare(&recalled, 48000.0).unwrap();
    assert_realtime_clean(|| {
        let _section = truce::rt::RtSection::enter();
        for index in 0..4096 {
            let left = (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.25;
            let right = (std::f32::consts::TAU * 2200.0 * index as f32 / 48000.0).sin() * 0.1;
            let expected = expected.process_stereo(left, right);
            let actual = actual.process_stereo(left, right);
            assert!(
                (actual.0 - expected.0).abs() < 1.0e-6 && (actual.1 - expected.1).abs() < 1.0e-6
            );
        }
    });
}

#[test]
fn sidechain_is_measured_without_changing_static_main_audio_in_any_processing_mode() {
    let main: Vec<_> = (0..16384)
        .map(|index| (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.05)
        .collect();
    let external: Vec<_> = main.iter().map(|sample| sample * 10.0).collect();
    let silence = vec![0.0; main.len()];
    for mode in 0..3 {
        let params = EqParams::default();
        params.set_plain(2, mode as f64);
        params.set_plain(7, 0.0);
        params.set_plain(100, 1.0);
        params.set_plain(103, 1500.0);
        params.set_plain(104, 6.0);
        let render = |sidechain: &[f32]| {
            let mut state = EqDspState::default();
            state.reset(&params, 48000.0);
            let mut output = [vec![0.0; main.len()], vec![0.0; main.len()]];
            let inputs = [main.as_slice(), main.as_slice(), sidechain, sidechain];
            let [left, right] = &mut output;
            let mut outputs = [left.as_mut_slice(), right.as_mut_slice()];
            let mut buffer = AudioBuffer::from_slices_checked(&inputs, &mut outputs, main.len());
            let events = EventList::with_capacity(0);
            assert_realtime_clean(|| {
                let _section = truce::rt::RtSection::enter();
                state.process(&params, &mut buffer, &events);
            });
            (output, params.telemetry.spectrum())
        };
        let (disconnected, quiet) = render(&silence);
        let (connected, measured) = render(&external);
        assert_eq!(
            connected, disconnected,
            "sidechain changed main audio in mode {mode}"
        );
        assert!(quiet.external_db.iter().all(|level| *level == -120.0));
        let peak = measured
            .pre_db
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        assert!((measured.external_db[peak] - measured.pre_db[peak] - 20.0).abs() < 0.01);
        assert!((measured.post_db[peak] - measured.pre_db[peak] - 6.0).abs() < 0.05);
    }
}

#[test]
fn malformed_and_extreme_samples_stay_finite_in_full_native_pipeline() {
    let params = EqParams::default();
    for (index, band) in params.bands().into_iter().enumerate() {
        band.present.set_value(true);
        band.gain.set_value(36.0);
        band.frequency.set_value(1500.0);

        band.order.set_value(index as i64);
    }
    params.output_gain.set_value(60.0);
    params.auto_gain.set_value(true);
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    let input: Vec<_> = (0..8192)
        .map(|index| match index % 8 {
            0 => f32::NAN,
            1 => f32::INFINITY,
            2 => f32::NEG_INFINITY,
            3 => f32::MAX,
            4 => -f32::MAX,
            _ => 0.25,
        })
        .collect();
    let output = render_block(&mut state, &params, &input, &EventList::with_capacity(0));
    assert!(output.iter().all(|value| value.is_finite()));
    let snapshot = params.telemetry.spectrum();
    assert!(
        snapshot
            .pre_db
            .iter()
            .chain(&snapshot.post_db)
            .all(|value| value.is_finite())
    );
}

#[test]
fn editor_transaction_keeps_previous_core_and_all_output_settings_until_commit() {
    let params = EqParams::default();
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    let events = EventList::with_capacity(0);
    let transaction = params.telemetry.begin_parameter_edit();
    params.band01.present.set_value(true);
    params.band01.gain.set_value(12.0);
    params.output_gain.set_value(-6.0);
    params.phase_invert.set_value(true);
    params.auto_gain.set_value(true);
    let while_editing = render_block(&mut state, &params, &[0.25; 1024], &events);
    assert!(while_editing.iter().all(|sample| *sample == 0.25));
    assert!(params.telemetry.active_config().unwrap().bands.is_empty());
    drop(transaction);
    let committed = render_block(&mut state, &params, &[0.25; 8192], &events);
    assert!(committed[4096..].iter().all(|sample| *sample < -0.1));
    assert_eq!(params.telemetry.active_config().unwrap().bands.len(), 1);
}

#[test]
fn pending_linear_mode_keeps_accepted_static_audio_until_warmed_processor_handoff() {
    use heron_dsp_core::eq::ProcessingMode;
    let settings = || {
        let params = EqParams::default();
        params.set_plain(100, 1.0);
        params.set_plain(103, 1500.0);
        params.set_plain(105, 3.0);
        params.set_plain(104, -12.0);

        params.set_plain(7, 0.0);
        params
    };
    let params = settings();
    let reference_params = settings();
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    let mut reference = EqDspState::default();
    reference.reset(&reference_params, 48000.0);
    let input: Vec<_> = (0..8192)
        .map(|index| (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.5)
        .collect();
    let events = EventList::with_capacity(0);
    render_block(&mut state, &params, &input, &events);
    render_block(&mut reference, &reference_params, &input, &events);
    params.processing_mode.set_value(2);
    let pending = render_block(&mut state, &params, &input[..512], &events);
    let expected = render_block(&mut reference, &reference_params, &input[..512], &events);
    assert!(
        pending
            .iter()
            .zip(expected)
            .all(|(actual, expected)| (*actual - expected).abs() < 1.0e-7)
    );
    assert_eq!(state.latency_samples(), 0);
    assert_eq!(
        params.telemetry.active_config().unwrap().processing_mode,
        ProcessingMode::ZeroLatency
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while state.latency_samples() != 512 && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(2));
        let transition = render_block(&mut state, &params, &input[..1024], &events);
        // Both prepared static paths retain the cut while the warmed owner fades in.
        assert!(transition.iter().all(|sample| sample.abs() < 0.16));
    }
    assert_eq!(state.latency_samples(), 512);
    assert_eq!(
        params.telemetry.active_config().unwrap().processing_mode,
        ProcessingMode::LinearPhase
    );
}

#[test]
fn static_response_metadata_uses_accepted_solo_and_full_bypass() {
    let params = EqParams::default();
    params.band01.present.set_value(true);
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    let events = EventList::with_capacity(0);
    render_block(&mut state, &params, &[0.25; 128], &events);
    assert!(params.telemetry.spectrum().static_response_valid);
    params.telemetry.set_solo(Some(1));
    render_block(&mut state, &params, &[0.25; 128], &events);
    assert!(!params.telemetry.spectrum().static_response_valid);
    params.bypass.set_value(true);
    render_block(&mut state, &params, &[0.25; 8192], &events);
    let snapshot = params.telemetry.spectrum();
    assert!(snapshot.bypassed && snapshot.static_response_valid);
}

#[test]
fn invalid_static_shape_keeps_previous_audio_and_reset_publishes_actual_fallback() {
    let params = EqParams::default();
    params.set_plain(100, 1.0);
    params.set_plain(103, 1500.0);
    params.set_plain(104, 6.0);
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    let input: Vec<_> = (0..8192)
        .map(|index| (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.1)
        .collect();
    let events = EventList::with_capacity(0);
    render_block(&mut state, &params, &input, &events);
    let accepted = params.telemetry.active_config().unwrap();
    params.band01.slope.set_value(1000.0);

    params.phase_invert.set_value(true);
    params.output_gain.set_value(-12.0);
    let output = render_block(&mut state, &params, &input, &events);
    let energy = |values: &[f32]| {
        values[4096..]
            .iter()
            .map(|value| f64::from(*value).powi(2))
            .sum::<f64>()
    };
    assert!((10.0 * (energy(&output) / energy(&input)).log10() - 6.0).abs() < 0.01);
    assert_eq!(params.telemetry.active_config().unwrap(), accepted);
    assert_eq!(state.latency_samples(), 0);
    state.reset(&params, 96000.0);
    assert!(params.telemetry.processing_error().is_some());
    assert!(params.telemetry.active_config().unwrap().bands.is_empty());
    let response = params.telemetry.prepared_response().unwrap();
    assert_eq!(response.sample_rate, 96000.0);
    assert!(response.stereo_db.iter().all(|value| value.abs() < 1.0e-6));
    let fallback = render_block(&mut state, &params, &[0.25; 1024], &events);
    assert!(fallback.iter().all(|sample| *sample == 0.25));
}

#[test]
fn native_output_balance_uses_actual_layout_and_global_bypass_covers_pan() {
    let render = |state: &mut EqDspState, params: &EqParams, inputs: &[&[f32]], width: usize| {
        let length = inputs[0].len();
        let mut output = vec![vec![0.0; length]; width];
        let mut slices: Vec<_> = output.iter_mut().map(Vec::as_mut_slice).collect();
        let mut buffer = AudioBuffer::from_slices_checked(inputs, &mut slices, length);
        let events = EventList::with_capacity(0);
        assert_realtime_clean(|| {
            let _section = truce::rt::RtSection::enter();
            state.process(params, &mut buffer, &events);
        });
        output
    };
    for (mode, input_count, output_count, expected) in [
        (0, 2, 2, [0.0, 0.25]),
        (1, 2, 2, [0.0, 0.0]),
        (0, 1, 2, [0.0, 0.25]),
        (0, 1, 1, [0.25, 0.0]),
        (1, 1, 1, [0.25, 0.0]),
    ] {
        let params = EqParams::default();
        params.output_pan.set_value(1.0);
        params.output_pan_mode.set_value(mode);
        let mut state = EqDspState::default();
        state.reset(&params, 48000.0);
        let input = [0.25; 128];
        let inputs = vec![input.as_slice(); input_count];
        let output = render(&mut state, &params, &inputs, output_count);
        assert_eq!(params.telemetry.stereo_output(), output_count > 1);
        for (channel, samples) in output.iter().enumerate() {
            assert!(samples.iter().all(|sample| *sample == expected[channel]));
        }
        if output_count == 1 {
            assert_eq!(
                params.telemetry.spectrum().output_pan_matrix,
                [[1.0, 0.0], [0.0, 1.0]]
            );
        }
    }
    let params = EqParams::default();
    params.output_pan.set_value(1.0);
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    let input = [0.25; 8192];
    let inputs = [input.as_slice(), input.as_slice()];
    render(&mut state, &params, &inputs, 2);
    params.bypass.set_value(true);
    let bypassed = render(&mut state, &params, &inputs, 2);
    assert!(
        bypassed
            .iter()
            .all(|samples| samples[4096..].iter().all(|sample| *sample == 0.25))
    );
}

#[test]
fn output_mute_recall_silences_the_complete_stereo_chain_and_bypass_returns_delayed_dry() {
    let params = EqParams::default();
    params.processing_mode.set_value(2);
    params.linear_phase_resolution.set_value(0);
    params.band01.present.set_value(true);
    params.band01.gain.set_value(12.0);

    params.output_gain.set_value(12.0);
    params.phase_invert.set_value(true);
    params.auto_gain.set_value(true);
    params.output_pan.set_value(0.5);
    params.output_pan_mode.set_value(1);
    let input: Vec<_> = (0..32768)
        .map(|index| (std::f32::consts::TAU * 1500.0 * index as f32 / 48000.0).sin() * 0.25)
        .collect();
    let events = EventList::with_capacity(0);
    let mut state = EqDspState::default();
    state.reset(&params, 48000.0);
    render_block(&mut state, &params, &input[..8192], &events);
    params.set_plain(10, 1.0);
    let transition = render_block(&mut state, &params, &input[8192..16384], &events);
    assert!(transition[4096..].iter().all(|sample| *sample == 0.0));
    render_block(&mut state, &params, &input[16384..24576], &events);
    let spectrum = params.telemetry.spectrum();
    assert!(spectrum.output_muted && !spectrum.static_response_valid);
    assert_eq!(spectrum.output_peak, [0.0; 2]);
    assert!(spectrum.post_db.iter().all(|value| *value == -120.0));
    assert_eq!(params.output_gain.raw_target(), 12.0); // Finite fitted trim is preserved through mute.
    let recalled = EqParams::default();
    for info in EqParams::param_infos_static() {
        recalled.set_normalized(info.id, params.get_normalized(info.id).unwrap());
    }
    assert!(recalled.output_mute.value());
    let mut recalled_state = EqDspState::default();
    recalled_state.reset(&recalled, 48000.0);
    let muted = render_block(&mut recalled_state, &recalled, &input[..8192], &events);
    assert!(muted.iter().all(|sample| *sample == 0.0));
    assert_eq!(recalled_state.latency_samples(), 512);
    recalled.bypass.set_value(true);
    let bypassed = render_block(&mut recalled_state, &recalled, &input[8192..16384], &events);
    for index in 4096..8192 {
        assert!((bypassed[index] - input[8192 + index - 512]).abs() < 1.0e-6);
    }
    assert!(recalled.telemetry.spectrum().bypassed && !recalled.telemetry.spectrum().output_muted);
}
