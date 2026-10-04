use super::{CoherentSpectrum, StereoRoute};
use crate::plugin_analysis::{Chain, lock_in};
use heron_audio_plugin::{
    AudioPluginProcessor, AudioPluginProcessorHandle, ProcessContext, SidechainSource,
};
use heron_dsp_runtime::protocol::PluginAnalysisSettings;
use std::sync::{Arc, atomic::AtomicBool};

#[test]
fn coherent_bins_preserve_weak_orders_at_the_original_capture_length() {
    let mut spectrum = CoherentSpectrum::new();
    // Non-power-of-two and odd captures must not be padded: that would move
    // coherent orders between bins and lose both weak harmonics and calibration.
    for (length, cycles) in [(16384, 37), (24000, 10), (24007, 11)] {
        let amplitudes = [0.7, 7e-11, 0.0, 0.035, 0.0, 0.0, 7e-13, 7e-15];
        let samples: Vec<_> = (0..length)
            .map(|index| {
                let value = 0.2
                    + amplitudes
                        .iter()
                        .enumerate()
                        .map(|(order, amplitude)| {
                            amplitude
                                * (std::f64::consts::TAU
                                    * cycles as f64
                                    * (order + 1) as f64
                                    * index as f64
                                    / length as f64
                                    + 0.37)
                                    .sin()
                        })
                        .sum::<f64>();
                [value, 0.0]
            })
            .collect();
        spectrum.measure(&samples, StereoRoute::Channel(0));
        let mono: Vec<_> = samples.iter().map(|frame| frame[0]).collect();
        for (order, expected) in amplitudes.into_iter().enumerate() {
            let actual = spectrum.amplitude(cycles * (order + 1));
            let reference = lock_in(&mono, cycles as f64, order + 1, length);
            assert!(
                (actual - expected).abs() < 1e-14,
                "length={length} order={} actual={actual} expected={expected}",
                order + 1,
            );
            assert!(
                (actual - reference).abs() < 1e-14,
                "length={length} order={} actual={actual} lock_in={reference}",
                order + 1,
            );
        }
        // H8 is below the existing relative amplitude floor; it stays at that
        // floor, while the -200 dB H2 remains a measured value above it.
        let fundamental = spectrum.amplitude(cycles);
        let reported_db = |order| {
            20.0 * (spectrum.amplitude(cycles * order) / fundamental)
                .max(1e-12)
                .log10()
        };
        assert!((reported_db(2) + 200.0).abs() < 0.002);
        assert_eq!(reported_db(8), -240.0);
    }
}

#[test]
fn coherent_bins_retain_weak_energy_near_nyquist() {
    let mut spectrum = CoherentSpectrum::new();
    for (length, cycles, maximum_order) in [(65536, 4095, 8), (24007, 10803, 1)] {
        let samples: Vec<_> = (0..length)
            .map(|index| {
                let value = (1..=maximum_order)
                    .map(|order| {
                        let amplitude = if order == 1 { 0.7 } else { 7e-13 };
                        // Integer phase reduction makes the known waveform
                        // independent of large-angle trigonometric rounding.
                        let phase = std::f64::consts::TAU
                            * ((cycles * order * index) % length) as f64
                            / length as f64;
                        amplitude * (phase + 0.37).sin()
                    })
                    .sum::<f64>();
                [value, 0.0]
            })
            .collect();
        spectrum.measure(&samples, StereoRoute::Channel(0));
        let mono: Vec<_> = samples.iter().map(|frame| frame[0]).collect();
        for order in 1..=maximum_order {
            let expected = if order == 1 { 0.7 } else { 7e-13 };
            let actual = spectrum.amplitude(cycles * order);
            assert!((actual - expected).abs() < 1e-14);
            // The old direct sum accumulates larger trig-argument error at
            // high bins. Keep that comparison separate from the tight oracle.
            let reference = lock_in(&mono, cycles as f64, order, length);
            assert!((actual - reference).abs() < 5e-13);
        }
    }
}

#[test]
fn coherent_bins_match_lock_in_for_clipping_and_mid_side_routes() {
    let length = 24007;
    let cycles = 31;
    let samples: Vec<_> = (0..length)
        .map(|index| {
            let phase = std::f64::consts::TAU * cycles as f64 * index as f64 / length as f64;
            [
                (0.9 * phase.sin()).clamp(-0.25, 0.25),
                (0.7 * (phase + 0.2).sin()).clamp(-0.4, 0.4),
            ]
        })
        .collect();
    let mut spectrum = CoherentSpectrum::new();
    for route in [
        StereoRoute::Channel(0),
        StereoRoute::Channel(1),
        StereoRoute::Mid,
        StereoRoute::Side,
    ] {
        spectrum.measure(&samples, route);
        let mono: Vec<_> = samples.iter().map(|frame| route.measure(*frame)).collect();
        for order in 1..=8 {
            let reference = lock_in(&mono, cycles as f64, order, length);
            assert!((spectrum.amplitude(cycles * order) - reference).abs() < 1e-14);
        }
    }
    // A subsequent silent capture must not retain the preceding spectrum's
    // imaginary components or samples when its exact length changes.
    spectrum.measure(&vec![[0.0; 2]; 16384], StereoRoute::Mid);
    assert_eq!(spectrum.amplitude(17), 0.0);
}

#[derive(Clone)]
struct Clip;

impl AudioPluginProcessor for Clip {
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
                *value = value.clamp(-0.2, 0.2);
            }
        }
        true
    }
}

#[test]
fn harmonic_reports_keep_nyquist_availability_for_mid_side_clipping() {
    for route in [StereoRoute::Mid, StereoRoute::Side] {
        let mut chain = Chain {
            processors: vec![AudioPluginProcessorHandle::new(Clip)],
            comparison_processors: None,
            settings: PluginAnalysisSettings {
                start_hz: 6000.0,
                end_hz: 20000.0,
                level_dbfs: 6.0,
                mid_side: true,
                ..PluginAnalysisSettings::default()
            },
            cancel: Arc::new(AtomicBool::new(false)),
            clock: 0,
            times: Vec::new(),
        };
        let report = chain.harmonics(route).unwrap();
        assert_eq!(report.channel, route.index());
        for (index, frequency) in report.frequency_hz.iter().enumerate() {
            assert!(report.fundamental_gain_db[index].is_some());
            for order in 2..=8 {
                assert_eq!(
                    report.orders_db[order - 2][index].is_some(),
                    frequency * (order as f64) < 24000.0,
                );
            }
            assert_eq!(
                report.thd_percent[index].is_some(),
                frequency * 2.0 < 24000.0
            );
        }
    }
}
