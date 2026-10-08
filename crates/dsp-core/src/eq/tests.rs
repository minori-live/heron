use super::*;
use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
    f64::consts::PI,
};

struct CountedAllocator;
thread_local! {
    static TRACK: Cell<bool> = const { Cell::new(false) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
    static DEALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}
// SAFETY: Every allocation is delegated unchanged to Rust's System allocator.
unsafe impl GlobalAlloc for CountedAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if TRACK.with(Cell::get) {
            ALLOCATIONS.with(|count| count.set(count.get() + 1));
        }
        // SAFETY: Forward the caller's allocation layout to the same allocator.
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        if TRACK.with(Cell::get) {
            DEALLOCATIONS.with(|count| count.set(count.get() + 1));
        }
        // SAFETY: The pointer and layout originated from System.alloc above.
        unsafe { System.dealloc(pointer, layout) }
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if TRACK.with(Cell::get) {
            ALLOCATIONS.with(|count| count.set(count.get() + 1));
        }
        // SAFETY: Forward the caller's allocation and new size to System.
        unsafe { System.realloc(pointer, layout, size) }
    }
}
#[global_allocator]
static ALLOCATOR: CountedAllocator = CountedAllocator;

fn single(band: EqBand) -> EqConfig {
    EqConfig {
        bands: vec![band],
        ..EqConfig::default()
    }
}

fn measured_db(processor: &mut EqProcessor, frequency: f64, channel: EqChannel) -> f64 {
    let samples = 9600;
    let settle = 4800;
    let mut cosine = 0.0;
    let mut sine = 0.0;
    for index in 0..samples + settle {
        let phase = 2.0 * PI * frequency * index as f64 / 48000.0;
        let input = (phase.sin() * 0.1) as f32;
        let (left, right) = match channel {
            EqChannel::Left => (input, 0.0),
            EqChannel::Right => (0.0, input),
            EqChannel::Side => (input, -input),
            _ => (input, input),
        };
        let (left, right) = processor.process_stereo(left, right);
        let output = match channel {
            EqChannel::Right => right,
            EqChannel::Mid => (left + right) * 0.5,
            EqChannel::Side => (left - right) * 0.5,
            _ => left,
        };
        if index >= settle {
            cosine += f64::from(output) * phase.cos();
            sine += f64::from(output) * phase.sin();
        }
    }
    20.0 * (2.0 * cosine.hypot(sine) / (samples as f64 * 0.1))
        .max(1.0e-15)
        .log10()
}

#[test]
fn fit_rbj_center_and_shelf_endpoints_match_native_audio() {
    let bell = EqBand {
        gain_db: 9.0,
        q: 2.0,
        ..EqBand::default()
    };
    assert!((bell.magnitude_db(48000.0, 1000.0) - 9.0).abs() < 1.0e-10);
    // Normative fitter fixture, RBJ shelf Q=0.7 (not shelf S).
    let shelf = EqBand {
        shape: EqShape::LowShelf,
        frequency_hz: 120.0,
        gain_db: -7.5,
        q: 0.7,
        ..EqBand::default()
    };
    let coefficient = coefficients::design(&shelf, 48000.0).low[0];
    let fitter_coefficients = [
        0.9951314532240819,
        -1.9722714575105584,
        0.9772980241584706,
        -1.972163105361846,
        0.9725378295312649,
    ];
    for (native, fitted) in [
        coefficient.b0,
        coefficient.b1,
        coefficient.b2,
        coefficient.a1,
        coefficient.a2,
    ]
    .into_iter()
    .zip(fitter_coefficients)
    {
        assert!((native - fitted).abs() < 1.0e-12);
    }
    assert!((shelf.magnitude_db(48000.0, 0.0) + 7.5).abs() < 1.0e-8);
    assert!(shelf.magnitude_db(48000.0, 24000.0).abs() < 1.0e-8);
    let config = single(bell);
    let mut processor = EqProcessor::prepare(&config, 48000.0).expect("valid fitted EQ");
    assert!((measured_db(&mut processor, 1000.0, EqChannel::Stereo) - 9.0).abs() < 0.002);
}

#[test]
fn every_native_shape_has_audio_frequency_response_equal_to_its_display() {
    for shape in [
        EqShape::Bell,
        EqShape::LowShelf,
        EqShape::HighShelf,
        EqShape::LowCut,
        EqShape::HighCut,
        EqShape::Notch,
        EqShape::BandPass,
        EqShape::TiltShelf,
        EqShape::FlatTilt,
        EqShape::AllPass,
    ] {
        let band = EqBand {
            shape,
            frequency_hz: 1000.0,
            gain_db: 6.0,
            q: 0.9,
            ..EqBand::default()
        };
        let expected = band.magnitude_db(48000.0, 2000.0);
        let mut processor = EqProcessor::prepare(&single(band), 48000.0).expect("valid shape");
        let measured = measured_db(&mut processor, 2000.0, EqChannel::Stereo);
        assert!(
            (measured - expected).abs() < 0.01,
            "{shape:?}: display={expected}, audio={measured}"
        );
    }
}

#[test]
fn cut_orders_and_fractional_transition_share_the_actual_transfer() {
    for slope in [
        0.0, 0.5, 3.0, 5.75, 6.0, 12.0, 18.0, 24.0, 30.0, 36.0, 48.0, 72.0, 96.0, 15.0,
    ] {
        let band = EqBand {
            shape: EqShape::HighCut,
            slope_db_oct: slope,
            frequency_hz: 1000.0,
            ..EqBand::default()
        };
        let expected = band.magnitude_db(48000.0, 2000.0);
        let mut processor = EqProcessor::prepare(&single(band), 48000.0).expect("valid cut slope");
        let measured = measured_db(&mut processor, 2000.0, EqChannel::Stereo);
        assert!(
            (measured - expected).abs() < 0.02,
            "slope={slope}: display={expected}, audio={measured}"
        );
    }
    let first = EqBand {
        shape: EqShape::HighCut,
        slope_db_oct: 6.0,
        frequency_hz: 500.0,
        ..EqBand::default()
    };
    let six_db_drop = first.magnitude_db(48000.0, 8000.0) - first.magnitude_db(48000.0, 4000.0);
    assert!(six_db_drop < -6.0 && six_db_drop > -7.0);
}

#[test]
fn mid_and_side_processing_respect_the_orthogonal_projection() {
    for target in [
        EqChannel::Left,
        EqChannel::Right,
        EqChannel::Mid,
        EqChannel::Side,
    ] {
        let config = single(EqBand {
            gain_db: 12.0,
            channel: target,
            ..EqBand::default()
        });
        let mut processor = EqProcessor::prepare(&config, 48000.0).expect("channel EQ");
        assert!((measured_db(&mut processor, 1000.0, target) - 12.0).abs() < 0.002);
        let other = match target {
            EqChannel::Left => EqChannel::Right,
            EqChannel::Right => EqChannel::Left,
            EqChannel::Mid => EqChannel::Side,
            _ => EqChannel::Mid,
        };
        assert!(measured_db(&mut processor, 1000.0, other).abs() < 0.002);
    }
}

#[test]
fn prepared_mixed_channel_matrix_matches_impulse_dft_magnitude_and_phase_in_every_mode() {
    let frequencies = [187.5, 1500.0, 6000.0, 18000.0];
    for mode in [
        ProcessingMode::ZeroLatency,
        ProcessingMode::NaturalPhase,
        ProcessingMode::LinearPhase,
    ] {
        let config = EqConfig {
            processing_mode: mode,
            bands: vec![
                EqBand {
                    id: 1,
                    channel: EqChannel::Left,
                    gain_db: 6.0,
                    frequency_hz: 1000.0,
                    ..EqBand::default()
                },
                EqBand {
                    id: 2,
                    channel: EqChannel::Right,
                    shape: EqShape::HighShelf,
                    gain_db: -4.0,
                    frequency_hz: 3000.0,
                    ..EqBand::default()
                },
                EqBand {
                    id: 3,
                    channel: EqChannel::Mid,
                    shape: EqShape::LowShelf,
                    gain_db: 5.0,
                    frequency_hz: 500.0,
                    ..EqBand::default()
                },
                EqBand {
                    id: 4,
                    channel: EqChannel::Side,
                    gain_db: -7.0,
                    frequency_hz: 1700.0,
                    ..EqBand::default()
                },
            ],
            ..EqConfig::default()
        };
        for input_channel in 0..2 {
            let mut processor =
                EqProcessor::prepare(&config, 48000.0).expect("prepared mixed matrix");
            let expected = frequencies.map(|frequency| processor.response_matrix(frequency));
            let mut measured = [[EqResponse { re: 0.0, im: 0.0 }; 2]; 4];
            for sample in 0..8192 {
                let input = if sample == 0 { 1.0 } else { 0.0 };
                let (left, right) = if input_channel == 0 {
                    processor.process_stereo(input, 0.0)
                } else {
                    processor.process_stereo(0.0, input)
                };
                for (index, frequency) in frequencies.iter().enumerate() {
                    let phase = 2.0 * PI * frequency * sample as f64 / 48000.0;
                    for (response, value) in measured[index].iter_mut().zip([left, right]) {
                        response.re += f64::from(value) * phase.cos();
                        response.im -= f64::from(value) * phase.sin();
                    }
                }
            }
            for (index, matrix) in expected.iter().enumerate() {
                let column = if input_channel == 0 {
                    [matrix.left_to_left, matrix.left_to_right]
                } else {
                    [matrix.right_to_left, matrix.right_to_right]
                };
                for (actual, target) in measured[index].iter().zip(column) {
                    let error = (actual.re - target.re).hypot(actual.im - target.im);
                    assert!(
                        error < 2.0e-5,
                        "{mode:?} input {input_channel}, f={} Hz: measured={actual:?}, prepared={target:?}, error={error}",
                        frequencies[index]
                    );
                }
            }
        }
    }
}

#[test]
fn natural_phase_oversampled_audio_matches_alias_aware_transfer() {
    let config = EqConfig {
        processing_mode: ProcessingMode::NaturalPhase,
        bands: vec![EqBand {
            frequency_hz: 12000.0,
            gain_db: 10.0,
            q: 0.7,
            ..EqBand::default()
        }],
        ..EqConfig::default()
    };
    let mut processor = EqProcessor::prepare(&config, 48000.0).expect("oversampled EQ");
    assert_eq!(processor.latency_samples(), 16);
    for frequency in [1000.0, 12000.0, 18000.0] {
        let expected = config.magnitude_db(48000.0, frequency, EqChannel::Stereo);
        let measured = measured_db(&mut processor, frequency, EqChannel::Stereo);
        assert!(
            (measured - expected).abs() < 0.01,
            "f={frequency}: display={expected}, audio={measured}"
        );
    }
    let flat = EqConfig {
        processing_mode: ProcessingMode::NaturalPhase,
        ..EqConfig::default()
    };
    let mut identity = EqProcessor::prepare(&flat, 48000.0).expect("natural identity");
    assert!(measured_db(&mut identity, 22000.0, EqChannel::Stereo).abs() < 0.001);
    assert!(flat.magnitude_db(48000.0, 22000.0, EqChannel::Stereo).abs() < 1.0e-10);
}

#[test]
fn linear_phase_audio_matches_its_prepared_finite_fir_response_and_latency() {
    let config = EqConfig {
        processing_mode: ProcessingMode::LinearPhase,
        linear_phase_resolution: LinearPhaseResolution::Low,
        bands: vec![EqBand {
            gain_db: 6.0,
            ..EqBand::default()
        }],
        ..EqConfig::default()
    };
    let mut processor = EqProcessor::prepare(&config, 48000.0).expect("FIR EQ");
    assert_eq!(processor.latency_samples(), 512);
    for frequency in [1000.0, 4000.0] {
        let expected = processor
            .response_matrix(frequency)
            .left_to_left
            .magnitude_db();
        let measured = measured_db(&mut processor, frequency, EqChannel::Stereo);
        assert!(
            (measured - expected).abs() < 0.005,
            "f={frequency}: FIR={expected}, audio={measured}"
        );
    }
    let empty = EqConfig {
        bands: vec![],
        ..config
    };
    let mut identity = EqProcessor::prepare(&empty, 48000.0).expect("identity FIR");
    for index in 0..1024 {
        let output = identity.process_stereo(if index == 0 { 1.0 } else { 0.0 }, 0.0);
        assert!(
            (output.0 - if index == 512 { 1.0 } else { 0.0 }).abs() < 1.0e-6,
            "sample={index}, output={output:?}"
        );
    }
}

#[test]
fn linear_resolution_and_steep_cut_have_real_bounded_fir_designs() {
    for resolution in [
        LinearPhaseResolution::Low,
        LinearPhaseResolution::Medium,
        LinearPhaseResolution::High,
        LinearPhaseResolution::VeryHigh,
        LinearPhaseResolution::Maximum,
    ] {
        let config = EqConfig {
            processing_mode: ProcessingMode::LinearPhase,
            linear_phase_resolution: resolution,
            ..EqConfig::default()
        };
        let mut processor = EqProcessor::prepare(&config, 48000.0).expect("resolution");
        assert_eq!(processor.latency_samples(), resolution.taps() / 2 + 256);
        let mut peak = (0, 0.0_f32);
        for index in 0..processor.latency_samples() + 512 {
            let output = processor
                .process_stereo(if index == 0 { 1.0 } else { 0.0 }, 0.0)
                .0;
            if output.abs() > peak.1 {
                peak = (index, output.abs());
            }
        }
        assert_eq!(peak.0, resolution.latency_samples());
        assert!((peak.1 - 1.0).abs() < 1.0e-6);
    }
    let config = EqConfig {
        processing_mode: ProcessingMode::LinearPhase,
        bands: vec![EqBand {
            shape: EqShape::HighCut,
            frequency_hz: 4000.0,
            slope_db_oct: BRICKWALL_SLOPE,
            ..EqBand::default()
        }],
        ..EqConfig::default()
    };
    let processor = EqProcessor::prepare(&config, 48000.0).expect("steep FIR");
    assert!(
        processor
            .response_matrix(3000.0)
            .left_to_left
            .magnitude_db()
            .abs()
            < 0.01
    );
    assert!(
        processor
            .response_matrix(5000.0)
            .left_to_left
            .magnitude_db()
            < -60.0
    );
}

#[test]
fn invalid_update_is_atomic_and_malformed_inputs_cannot_poison_recursive_state() {
    let config = single(EqBand {
        gain_db: 6.0,
        ..EqBand::default()
    });
    let mut processor = EqProcessor::prepare(&config, 48000.0).expect("EQ");
    let mut invalid = config.clone();
    invalid.bands[0].q = f64::NAN;
    assert_eq!(processor.update_rt(&invalid), Err(EqError::QOutOfRange));
    let output = processor.process_stereo(f32::NAN, f32::INFINITY);
    assert_eq!(output, (0.0, 0.0));
    assert!((measured_db(&mut processor, 1000.0, EqChannel::Stereo) - 6.0).abs() < 0.002);
    invalid = config.clone();
    invalid.bands.push(config.bands[0]);
    assert_eq!(invalid.validate(48000.0), Err(EqError::DuplicateBandId));
    let mut excessive = EqConfig::default();
    excessive.bands.extend((0..25).map(|id| EqBand {
        id,
        ..EqBand::default()
    }));
    assert_eq!(excessive.validate(48000.0), Err(EqError::TooManyBands));
}

#[test]
fn parameter_transition_starts_from_previous_audio_and_reaches_new_transfer() {
    let config = single(EqBand::default());
    let mut processor = EqProcessor::prepare(&config, 48000.0).expect("EQ");
    for _ in 0..1000 {
        processor.process_stereo(0.2, 0.2);
    }
    let changed = single(EqBand {
        shape: EqShape::LowShelf,
        gain_db: 12.0,
        frequency_hz: 1000.0,
        ..EqBand::default()
    });
    processor.update_rt(&changed).expect("RT edit");
    assert!((processor.process_stereo(0.2, 0.2).0 - 0.2).abs() < 1.0e-6);
    let mut output = 0.0;
    for _ in 0..5000 {
        output = processor.process_stereo(0.2, 0.2).0;
    }
    assert!((f64::from(output) / 0.2 - 10.0_f64.powf(12.0 / 20.0)).abs() < 0.001);
}

#[test]
fn overlapping_iir_edits_preserve_running_audio_and_settle_only_the_latest_target() {
    for mode in [ProcessingMode::ZeroLatency, ProcessingMode::NaturalPhase] {
        let mut config = single(EqBand {
            shape: EqShape::LowShelf,
            gain_db: 12.0,
            frequency_hz: 2000.0,
            ..EqBand::default()
        });
        config.processing_mode = mode;
        let mut processor = EqProcessor::prepare(&config, 48000.0).expect("EQ");
        let mut control = EqProcessor::prepare(&config, 48000.0).expect("control");
        for _ in 0..4000 {
            processor.process_stereo(0.1, 0.1);
            control.process_stereo(0.1, 0.1);
        }
        config.bands[0].gain_db = -12.0;
        processor.update_rt(&config).expect("first fade");
        control.update_rt(&config).expect("control fade");
        for _ in 0..100 {
            assert_eq!(
                processor.process_stereo(0.1, 0.1),
                control.process_stereo(0.1, 0.1)
            );
        }
        config.bands[0].gain_db = -6.0;
        processor.update_rt(&config).expect("queued edit");
        assert!(processor.has_pending_band_update());
        assert_eq!(processor.active_config().bands[0].gain_db, -12.0);
        assert_eq!(processor.band_revision(), 1);
        for _ in 0..20 {
            assert_eq!(
                processor.process_stereo(0.1, 0.1),
                control.process_stereo(0.1, 0.1)
            );
        }
        config.bands[0].gain_db = 3.0;
        processor.update_rt(&config).expect("replace queued edit");
        let mut previous = 0.0;
        for _ in 0..120 {
            let actual = processor.process_stereo(0.1, 0.1);
            assert_eq!(actual, control.process_stereo(0.1, 0.1));
            previous = actual.0;
        }
        assert!(!processor.has_pending_band_update());
        assert_eq!(processor.active_config().bands[0].gain_db, 3.0);
        assert_eq!(processor.band_revision(), 2);
        for _ in 0..3000 {
            let current = processor.process_stereo(0.1, 0.1).0;
            assert!(
                (current - previous).abs() < 0.005,
                "audible jump in {mode:?}"
            );
            previous = current;
        }
        assert!((f64::from(previous) - 0.1 * 10.0_f64.powf(3.0 / 20.0)).abs() < 1.0e-6);
    }
}

#[test]
fn queued_iir_edit_can_be_cancelled_or_remove_every_band() {
    let initial = single(EqBand {
        shape: EqShape::LowShelf,
        gain_db: 12.0,
        ..EqBand::default()
    });
    let mut processor = EqProcessor::prepare(&initial, 48000.0).expect("EQ");
    let mut installed = initial.clone();
    installed.bands[0].gain_db = -12.0;
    let mut cancelled = installed.clone();
    cancelled.bands[0].gain_db = -6.0;
    processor.update_rt(&installed).expect("first fade");
    processor.process_stereo(0.1, 0.1);
    processor.update_rt(&cancelled).expect("queued edit");
    processor.update_rt(&installed).expect("cancel queued edit");
    assert!(!processor.has_pending_band_update());
    for _ in 0..1000 {
        processor.process_stereo(0.1, 0.1);
    }
    assert_eq!(processor.active_config(), &installed);
    assert_eq!(processor.band_revision(), 1);
    processor.update_rt(&initial).expect("next fade");
    processor
        .update_rt(&EqConfig::default())
        .expect("queue empty bands");
    assert!(processor.has_pending_band_update());
    for _ in 0..1000 {
        processor.process_stereo(0.1, 0.1);
    }
    assert!(!processor.has_pending_band_update());
    assert!(processor.active_config().bands.is_empty());
    assert_eq!(processor.process_stereo(0.1, 0.1), (0.1, 0.1));
}

#[test]
fn prepared_iir_updates_and_fft_callbacks_do_not_allocate_or_free() {
    let config = single(EqBand::default());
    let mut iir = EqProcessor::prepare(&config, 48000.0).expect("IIR");
    let changed = single(EqBand {
        frequency_hz: 2000.0,
        gain_db: 3.0,
        ..config.bands[0]
    });
    let linear_config = EqConfig {
        processing_mode: ProcessingMode::LinearPhase,
        linear_phase_resolution: LinearPhaseResolution::Low,
        ..EqConfig::default()
    };
    let mut fir = EqProcessor::prepare(&linear_config, 48000.0).expect("FIR");
    ALLOCATIONS.with(|count| count.set(0));
    DEALLOCATIONS.with(|count| count.set(0));
    TRACK.with(|track| track.set(true));
    let update = iir.update_rt(&changed);
    let mut updates_ok = update.is_ok();
    for index in 0..4096 {
        if index % 17 == 0 {
            // Rapid edits exercise both coalescing and queued promotion.
            let target = if index % 34 == 0 { &config } else { &changed };
            updates_ok &= iir.update_rt(target).is_ok();
        }
        let sample = (index as f32 * 0.13).sin() * 0.1;
        std::hint::black_box(iir.process_stereo(sample, sample));
        std::hint::black_box(fir.process_stereo(sample, sample));
    }
    TRACK.with(|track| track.set(false));
    assert!(updates_ok);
    assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    assert_eq!(DEALLOCATIONS.with(Cell::get), 0);
}

#[test]
fn maximum_instance_band_capacity_is_real_audio_and_zero_bands_are_transparent() {
    let config = EqConfig {
        bands: (0..MAX_EQ_BANDS)
            .map(|index| EqBand {
                id: index as u32,
                shape: EqShape::AllPass,
                frequency_hz: 100.0 + index as f64 * 200.0,
                ..EqBand::default()
            })
            .collect(),
        ..EqConfig::default()
    };
    let mut processor = EqProcessor::prepare(&config, 48000.0).expect("24 bands");
    assert!(measured_db(&mut processor, 4000.0, EqChannel::Stereo).abs() < 0.01);
    let mut transparent = EqProcessor::prepare(&EqConfig::default(), 48000.0).expect("empty EQ");
    assert_eq!(transparent.process_stereo(0.125, -0.25), (0.125, -0.25));
}

#[test]
fn bypass_retains_reported_latency_and_fit_output_gain_range_is_supported() {
    let full_gain = EqConfig {
        output_gain_db: 60.0,
        ..EqConfig::default()
    };
    let mut gain = EqProcessor::prepare(&full_gain, 48000.0).expect("fitter maximum output gain");
    assert_eq!(gain.process_stereo(0.01, -0.01), (10.0, -10.0));
    for mode in [
        ProcessingMode::ZeroLatency,
        ProcessingMode::NaturalPhase,
        ProcessingMode::LinearPhase,
    ] {
        let config = EqConfig {
            bypass: true,
            processing_mode: mode,
            output_gain_db: 60.0,
            linear_phase_resolution: LinearPhaseResolution::Low,
            ..EqConfig::default()
        };
        let mut processor = EqProcessor::prepare(&config, 48000.0).expect("bypassed EQ");
        let latency = processor.latency_samples();
        for index in 0..latency + 64 {
            let output = processor.process_stereo(if index == 0 { 0.1 } else { 0.0 }, 0.0);
            assert_eq!(output.0, if index == latency { 0.1 } else { 0.0 });
        }
    }
}

#[test]
fn extreme_valid_rbj_parameters_and_24_band_updates_remain_finite() {
    for (frequency_hz, q, gain_db) in [
        (20.0, 0.025, -36.0),
        (20.0, 40.0, 36.0),
        (23900.0, 0.025, 36.0),
        (23900.0, 40.0, -36.0),
    ] {
        let config = EqConfig {
            bands: (0..24)
                .map(|id| EqBand {
                    id,
                    shape: if id % 3 == 0 {
                        EqShape::Bell
                    } else if id % 3 == 1 {
                        EqShape::LowShelf
                    } else {
                        EqShape::HighShelf
                    },
                    frequency_hz,
                    q,
                    gain_db,
                    ..EqBand::default()
                })
                .collect(),
            ..EqConfig::default()
        };
        let mut processor = EqProcessor::prepare(&config, 48000.0).expect("valid extremes");
        for index in 0..1024 {
            let input = (index as f32 * 0.2).sin();
            let output = processor.process_stereo(input, -input);
            assert!(output.0.is_finite() && output.1.is_finite());
        }
        processor
            .update_rt(&EqConfig::default())
            .expect("delete all bands");
        for _ in 0..1024 {
            assert!(processor.process_stereo(0.1, 0.1).0.is_finite());
        }
    }
}

#[test]
fn fractional_bandpass_transition_is_continuous_below_six_db() {
    let mut previous = 0.0;
    for slope in [0.0, 0.5, 3.0, 5.75, 6.0, 6.5, 12.0] {
        let band = EqBand {
            shape: EqShape::BandPass,
            slope_db_oct: slope,
            frequency_hz: 1000.0,
            q: 1.0,
            ..EqBand::default()
        };
        let expected = band.magnitude_db(48000.0, 4000.0);
        assert!(expected <= previous + 1.0e-10);
        previous = expected;
        let mut processor = EqProcessor::prepare(&single(band), 48000.0).expect("fractional pass");
        assert!((measured_db(&mut processor, 4000.0, EqChannel::Stereo) - expected).abs() < 0.01);
    }
}
