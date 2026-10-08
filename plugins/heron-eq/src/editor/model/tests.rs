use super::*;

#[test]
fn rotary_group_changes_preserve_initial_offsets_and_one_reversible_gesture() {
    let mut model = Model::new(EqConfig::default());
    model.config.bands.clear();
    model.add(1000.0, -2.0);
    model.add(2000.0, 3.0);
    model.config.bands[0].q = 0.8;
    model.config.bands[1].q = 1.6;
    model.selected = [1, 2].into_iter().collect();
    let initial = model.config.clone();
    model.begin();
    model.knob(Number::Frequency, 1500.0);
    model.knob(Number::Frequency, 3000.0);
    assert_eq!(model.config.bands[0].frequency_hz, 3000.0);
    assert_eq!(model.config.bands[1].frequency_hz, 6000.0);
    model.cancel();
    assert_eq!(model.config, initial);
    assert!(!model.has_gesture());
    model.begin();
    model.knob(Number::Gain, 4.0);
    assert_eq!(model.config.bands[1].gain_db, 9.0);
    model.knob(Number::Q, 2.0);
    assert_eq!(model.config.bands[1].q, 4.0);
    model.cancel();
    assert_eq!(model.config, initial);
}

#[test]
fn creation_stops_at_twenty_four_bands_and_delete_reuses_only_free_id() {
    let mut model = Model::new(EqConfig::default());
    model.config.bands.clear();
    for _ in 0..24 {
        assert!(model.add(1000.0, 0.0).is_some());
    }
    assert!(model.add(2000.0, 3.0).is_none());
    model.selected.clear();
    model.selected.insert(7);
    model.remove_selected();
    assert_eq!(model.add(2000.0, 3.0), Some(7));
    assert_eq!(model.config.bands.len(), 24);
}

#[test]
fn group_drag_preserves_initial_octave_and_gain_offsets_until_cancel() {
    let mut model = Model::new(EqConfig::default());
    model.config.bands.clear();
    let a = model.add(100.0, -2.0).expect("free slot");
    let b = model.add(200.0, 3.0).expect("free slot");
    model.selected.insert(a);
    model.selected.insert(b);
    let before = model.config.clone();
    model.begin();
    model.drag(1.5, 2.0);
    model.drag(2.0, 4.0);
    assert!((model.config.bands[0].frequency_hz - 200.0).abs() < 0.0001);
    assert!((model.config.bands[1].frequency_hz - 400.0).abs() < 0.0001);
    assert!((model.config.bands[0].gain_db - 2.0).abs() < 0.0001);
    model.cancel();
    assert_eq!(model.config, before);
    model.begin();
    model.drag(2.0, 4.0);
    model.end();
    assert!((model.config.bands[1].gain_db - 7.0).abs() < 0.0001);
}

#[test]
fn cancel_restores_gesture_and_external_values_cannot_overwrite_active_drag() {
    let mut model = Model::new(EqConfig::default());
    model.config.bands.clear();
    let id = model.add(1000.0, 0.0).expect("free slot");
    model.selected.insert(id);
    let before = model.config.clone();
    model.begin();
    model.drag(2.0, 6.0);
    model.synchronize(before.clone());
    assert!((model.config.bands[0].frequency_hz - 2000.0).abs() < 0.001);
    model.cancel();
    assert_eq!(model.config, before);
    assert!(!model.has_gesture());
}

#[test]
fn duplicate_preserves_band_settings_with_a_new_stable_id() {
    let mut model = Model::new(EqConfig::default());
    model.config.bands.clear();
    model.add(3000.0, -4.0);
    model.config.bands[0].channel = EqChannel::Side;
    model.config.bands[0].q = 2.5;
    let original = model.config.bands[0];
    model.change(Model::duplicate_selected);
    let duplicate = model.config.bands[1];
    assert_eq!(
        duplicate,
        EqBand {
            id: duplicate.id,
            ..original
        }
    );
    assert_ne!(original.id, duplicate.id);
    assert_eq!(model.selected, BTreeSet::from([duplicate.id]));
}

#[test]
fn splitting_stereo_preserves_settings_and_reuses_free_ids() {
    for pair in [
        (EqChannel::Left, EqChannel::Right),
        (EqChannel::Mid, EqChannel::Side),
    ] {
        let original = EqBand {
            id: 7,
            frequency_hz: 3400.0,
            gain_db: -5.0,
            q: 2.7,
            enabled: false,
            ..EqBand::default()
        };
        let single_channel = EqBand {
            id: 1,
            channel: EqChannel::Side,
            ..EqBand::default()
        };
        let mut model = Model::new(EqConfig {
            bands: vec![original, single_channel],
            ..EqConfig::default()
        });
        model.selected.insert(1);
        model
            .change_checked(
                |state| assert_eq!(state.split_selected(pair.0, pair.1), Ok(1)),
                48000.0,
            )
            .expect("valid split");
        assert_eq!(
            model.config.bands,
            vec![
                EqBand {
                    channel: pair.0,
                    ..original
                },
                EqBand {
                    id: 2,
                    channel: pair.1,
                    ..original
                },
                single_channel
            ]
        );
        assert_eq!(model.selected, BTreeSet::from([1, 2, 7]));
    }
}

#[test]
fn group_split_capacity_failure_does_not_partially_mutate() {
    let mut model = Model::new(EqConfig::default());
    for _ in 0..23 {
        model.add(1000.0, 3.0);
    }
    model.selected = BTreeSet::from([1, 2]);
    model.extras.auto_gain = true;
    let before = model.config.clone();
    let selected = model.selected.clone();
    model
        .change_checked(
            |state| {
                assert_eq!(
                    state.split_selected(EqChannel::Left, EqChannel::Right),
                    Err(SplitError::Capacity)
                )
            },
            48000.0,
        )
        .expect("unchanged valid config");
    assert_eq!(model.config, before);
    assert_eq!(model.selected, selected);
    assert!(model.extras.auto_gain);
    model.selected = BTreeSet::from([1]);
    assert_eq!(model.split_selected(EqChannel::Mid, EqChannel::Side), Ok(1));
    assert_eq!(model.config.bands.len(), 24);
    assert!(
        model
            .config
            .bands
            .iter()
            .any(|band| band.id == 24 && band.channel == EqChannel::Side)
    );
}

#[test]
fn splitting_single_channel_or_invalid_pair_is_a_noop() {
    let mut model = Model::new(EqConfig {
        bands: vec![EqBand {
            id: 5,
            channel: EqChannel::Left,
            ..EqBand::default()
        }],
        ..EqConfig::default()
    });
    let before = model.config.clone();
    assert_eq!(model.split_selected(EqChannel::Mid, EqChannel::Side), Ok(0));
    assert_eq!(
        model.split_selected(EqChannel::Left, EqChannel::Side),
        Err(SplitError::InvalidPair)
    );
    assert_eq!(model.config, before);
    assert_eq!(model.selected, BTreeSet::from([5]));
}

#[test]
fn split_native_slot_roundtrip_preserves_mixed_channel_audio_order() {
    use heron_dsp_core::eq::EqProcessor;
    use truce::prelude::Params;

    let original = EqConfig {
        bands: vec![
            EqBand {
                id: 7,
                gain_db: 9.0,
                frequency_hz: 1000.0,
                q: 1.5,
                ..EqBand::default()
            },
            EqBand {
                id: 1,
                channel: EqChannel::Side,
                gain_db: 6.0,
                frequency_hz: 800.0,
                ..EqBand::default()
            },
            EqBand {
                id: 4,
                channel: EqChannel::Left,
                gain_db: -8.0,
                frequency_hz: 1800.0,
                ..EqBand::default()
            },
            EqBand {
                id: 5,
                channel: EqChannel::Mid,
                gain_db: 8.0,
                frequency_hz: 1400.0,
                ..EqBand::default()
            },
        ],
        ..EqConfig::default()
    };
    for pair in [
        (EqChannel::Left, EqChannel::Right),
        (EqChannel::Mid, EqChannel::Side),
    ] {
        let mut model = Model::new(original.clone());
        model
            .split_selected(pair.0, pair.1)
            .expect("room for split");
        let params = crate::params::EqParams::default();
        for (id, value) in params.normalized_values(&model.config) {
            params.set_normalized(id, value);
        }
        let restored = params.snapshot();
        let mut before = EqProcessor::prepare(&original, 48000.0).expect("original channel chain");
        let mut after =
            EqProcessor::prepare(&restored, 48000.0).expect("restored split channel chain");
        let mut wrongly_sorted = restored.clone();
        wrongly_sorted.bands.sort_unstable_by_key(|band| band.id);
        let mut wrong =
            EqProcessor::prepare(&wrongly_sorted, 48000.0).expect("different channel order");
        let mut wrong_difference = 0.0_f32;
        for sample in 0..4096 {
            let phase = std::f32::consts::TAU * sample as f32 / 48000.0;
            let input = ((phase * 1200.0).sin() * 0.1, (phase * 750.0).sin() * 0.1);
            let expected = before.process_stereo(input.0, input.1);
            let actual = after.process_stereo(input.0, input.1);
            let unordered = wrong.process_stereo(input.0, input.1);
            assert!(
                (expected.0 - actual.0).abs() < 2.0e-6 && (expected.1 - actual.1).abs() < 2.0e-6
            );
            wrong_difference = wrong_difference
                .max((unordered.0 - expected.0).abs())
                .max((unordered.1 - expected.1).abs());
        }
        assert!(
            wrong_difference > 0.01,
            "the fixture must detect order loss: {wrong_difference}"
        );
    }
}
