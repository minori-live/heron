//! Verify packaged EQ audio and metadata through Heron's VST3 host.

use std::{path::PathBuf, rc::Rc};

use heron_dsp_core::eq::EqConfig;
use heron_eq::EqParams;
use heron_vst3_host::{AudioLayout, ClassId, Module, PluginKind, StereoProcessor};
use serde::Deserialize;
use truce::prelude::Params;

#[derive(Deserialize)]
struct FitPreset {
    config: EqConfig,
}

#[derive(Deserialize)]
struct ResponseFixture {
    sample_rate: f64,
    frequency_hz: Vec<f64>,
    magnitude_db: Vec<f64>,
}

#[test]
#[ignore = "requires cargo truce build -p heron-eq --vst3 --debug"]
fn packaged_fit_preset_matches_audible_response_in_all_host_layouts() {
    let bundle =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/bundles/Heron EQ.vst3");
    let module = Rc::new(Module::open(&bundle).expect("built native EQ bundle"));
    let class: ClassId = "8A8341D5CA36B6C9A9572788F40EBB9F".parse().unwrap();
    let preset: FitPreset = serde_json::from_str(include_str!("fixtures/fit-preset.json")).unwrap();
    let fixture: ResponseFixture =
        serde_json::from_str(include_str!("fixtures/fit-response.json")).unwrap();
    let defaults = EqParams::default();
    let changes: Vec<_> = defaults
        .normalized_values(&preset.config)
        .into_iter()
        .filter(|(id, value)| (defaults.get_normalized(*id).unwrap() - value).abs() > 1.0e-12)
        .collect();

    for layout in [
        AudioLayout::Mono,
        AudioLayout::MonoToStereo,
        AudioLayout::Stereo,
    ] {
        for (&frequency, &expected_db) in fixture.frequency_hz.iter().zip(&fixture.magnitude_db) {
            let mut processor = StereoProcessor::create_with_layout(
                module.clone(),
                class,
                fixture.sample_rate,
                PluginKind::Effect,
                layout,
            )
            .expect("supported bundled layout");
            assert_eq!(processor.event_input_bus_count(), 1, "MIDI learn input bus");
            let mut input_left = [0.0_f32; 64];
            let mut input_right = [0.0_f32; 64];
            let mut output_left = [0.0_f32; 64];
            let mut output_right = [0.0_f32; 64];
            // The host intentionally bounds automation queues per block. Feed
            // the preset before measurement without overflowing that boundary.
            for chunk in changes.chunks(32) {
                for &(id, value) in chunk {
                    assert!(
                        processor.queue_parameter_change(0, id, value),
                        "parameter {id}"
                    );
                }
                processor
                    .process_stereo(
                        &mut input_left,
                        &mut input_right,
                        &mut output_left,
                        &mut output_right,
                    )
                    .expect("bounded preset automation block");
            }
            let mut input_energy = 0.0;
            let mut output_energy = [0.0; 2];
            // Half a second of settling, then an integer number of cycles for
            // every normative frequency. Output smoothing is part of the ABI.
            for block in 0..750_usize {
                for (index, sample) in input_left.iter_mut().enumerate() {
                    let position = block * 64 + index;
                    *sample = (0.05
                        * (std::f64::consts::TAU * frequency * position as f64
                            / fixture.sample_rate)
                            .sin()) as f32;
                }
                input_right.copy_from_slice(&input_left);
                processor
                    .process_stereo(
                        &mut input_left,
                        &mut input_right,
                        &mut output_left,
                        &mut output_right,
                    )
                    .expect("real VST3 audio block");
                if block >= 375 {
                    input_energy += input_left
                        .iter()
                        .map(|v| f64::from(*v).powi(2))
                        .sum::<f64>();
                    output_energy[0] += output_left
                        .iter()
                        .map(|v| f64::from(*v).powi(2))
                        .sum::<f64>();
                    output_energy[1] += output_right
                        .iter()
                        .map(|v| f64::from(*v).powi(2))
                        .sum::<f64>();
                }
            }
            assert_eq!(processor.latency_samples(), 0);
            let channels = if layout == AudioLayout::Mono { 1 } else { 2 };
            for energy in &output_energy[..channels] {
                let actual_db = 10.0 * (energy / input_energy).log10();
                assert!(
                    (actual_db - expected_db).abs() < 0.002,
                    "{layout:?} {frequency} Hz: audible {actual_db} dB, expected {expected_db} dB"
                );
            }
        }
    }
}

#[test]
#[ignore = "requires cargo truce build -p heron-eq --vst3 --debug"]
fn packaged_output_automation_starts_at_the_requested_block_boundary() {
    let bundle =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/bundles/Heron EQ.vst3");
    let module = Rc::new(Module::open(&bundle).expect("built native EQ bundle"));
    let class = "8A8341D5CA36B6C9A9572788F40EBB9F".parse().unwrap();
    let mut processor = StereoProcessor::create_with_layout(
        module,
        class,
        48000.0,
        PluginKind::Effect,
        AudioLayout::Stereo,
    )
    .unwrap();
    let mut left = [0.25; 64];
    let mut right = left;
    let mut output_left = [0.0; 64];
    let mut output_right = output_left;
    // Truce's current automation minimum is 32 samples. This verifies
    // Heron's output smoother preserves causality at that supported boundary.
    assert!(processor.queue_parameter_change(32, 0, 0.45)); // -6 dB
    processor
        .process_stereo(&mut left, &mut right, &mut output_left, &mut output_right)
        .unwrap();
    for channel in [output_left, output_right] {
        assert!(channel[..32].iter().all(|sample| *sample == 0.25));
        assert!(
            channel[32..]
                .iter()
                .all(|sample| *sample < 0.25 && *sample > 0.125)
        );
        assert!(channel[32..].windows(2).all(|pair| pair[1] < pair[0]));
    }
}
