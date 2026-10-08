use super::*;

fn measure(
    analyzer: &mut SpectrumAnalyzer,
    head: u64,
    sample_rate: f64,
    frequency: f64,
    amplitude: f32,
) {
    assert!(analyzer.capture_window(head, sample_rate, |sequence| {
        let input = (std::f64::consts::TAU * frequency * sequence as f64 / sample_rate).sin()
            as f32
            * amplitude;
        Some([
            input,
            -input,
            input * 0.5,
            -input * 0.5,
            input * 0.25,
            -input * 0.25,
        ])
    }));
}

fn peak(snapshot: &SpectrumSnapshot) -> usize {
    snapshot
        .pre_db
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .expect("spectrum")
        .0
}

fn assert_same_spectrum(actual: &SpectrumSnapshot, expected: &SpectrumSnapshot) {
    assert_eq!(actual.frequency_hz, expected.frequency_hz);
    assert_eq!(actual.pre_db, expected.pre_db);
    assert_eq!(actual.post_db, expected.post_db);
    assert_eq!(actual.external_db, expected.external_db);
    assert_eq!(actual.sequence, expected.sequence);
    assert_eq!(actual.sample_rate, expected.sample_rate);
}

#[test]
fn every_resolution_measures_tone_frequency_stereo_power_and_pre_post_gain() {
    for resolution in [
        AnalyzerResolution::Low,
        AnalyzerResolution::Medium,
        AnalyzerResolution::High,
        AnalyzerResolution::Maximum,
    ] {
        let mut analyzer = SpectrumAnalyzer::new();
        analyzer
            .configure(AnalyzerConfig {
                resolution,
                speed: AnalyzerSpeed::Off,
                tilt_db_oct: 0.0,
                channel: EqChannel::Stereo,
            })
            .expect("resolution");
        measure(
            &mut analyzer,
            resolution.fft_size() as u64,
            48000.0,
            750.0,
            0.5,
        );
        let raw = analyzer.raw_snapshot();
        let peak = peak(&raw);
        assert!(
            (raw.frequency_hz[peak] - 750.0).abs() < 48000.0 / resolution.fft_size() as f32 + 15.0
        );
        assert!((raw.pre_db[peak] + 6.0206).abs() < 0.01);
        assert!((raw.post_db[peak] - raw.pre_db[peak] + 6.0206).abs() < 0.01);
        assert!((raw.external_db[peak] - raw.pre_db[peak] + 12.0412).abs() < 0.01);
        // Antiphase stereo must retain its power. 0.5-peak sine has 0.125 RMS power.
        assert!((analyzer.rms_db()[0] + 9.0309).abs() < 0.01);
        assert_eq!(raw.sequence, resolution.fft_size() as u64);
    }
}

#[test]
fn display_speed_changes_decay_by_elapsed_audio_time_and_raw_match_stays_exact() {
    let mut fast = SpectrumAnalyzer::new();
    let mut slow = SpectrumAnalyzer::new();
    fast.configure(AnalyzerConfig {
        speed: AnalyzerSpeed::Fast,
        tilt_db_oct: 4.5,
        ..AnalyzerConfig::default()
    })
    .expect("fast");
    slow.configure(AnalyzerConfig {
        speed: AnalyzerSpeed::Slow,
        tilt_db_oct: 4.5,
        ..AnalyzerConfig::default()
    })
    .expect("slow");
    measure(&mut fast, 4096, 48000.0, 1500.0, 0.5);
    measure(&mut slow, 4096, 48000.0, 1500.0, 0.5);
    let index = peak(&fast.raw_snapshot());
    let before = fast.display_snapshot().pre_db[index];
    measure(&mut fast, 8192, 48000.0, 1500.0, 0.01);
    measure(&mut slow, 8192, 48000.0, 1500.0, 0.01);
    let raw_fast = fast.raw_snapshot();
    let raw_slow = slow.raw_snapshot();
    assert_eq!(raw_fast.pre_db, raw_slow.pre_db);
    assert!((raw_fast.pre_db[index] + 40.0).abs() < 0.01);
    let fast_db = fast.display_snapshot().pre_db[index];
    let slow_db = slow.display_snapshot().pre_db[index];
    assert!(fast_db < slow_db - 5.0 && fast_db < before);
    let tilt = 4.5 * (raw_fast.frequency_hz[index] / 1000.0).log2();
    // The same tone's rounded spatial shape scales with amplitude squared.
    // Its decay still follows the configured seconds, independently of tilt.
    let initial_power = 10.0_f64.powf(f64::from(before - tilt) / 10.0);
    let history = (-4096.0_f64 / (48000.0 * 0.05)).exp();
    let expected_power = initial_power * (history + (1.0 - history) * 0.0004);
    assert!((fast_db - (10.0 * expected_power.log10() as f32 + tilt)).abs() < 0.02);
}

#[test]
fn resolution_and_sample_rate_changes_reset_display_history_and_wait_for_a_coherent_window() {
    let mut analyzer = SpectrumAnalyzer::new();
    measure(&mut analyzer, 4096, 48000.0, 1500.0, 0.5);
    analyzer
        .configure(AnalyzerConfig {
            resolution: AnalyzerResolution::Maximum,
            ..AnalyzerConfig::default()
        })
        .expect("larger FFT");
    assert_eq!(analyzer.fft_size(), 8192);
    assert!(!analyzer.ready(4096, 0));
    assert!(analyzer.ready(8192, 0));
    measure(&mut analyzer, 8192, 48000.0, 1500.0, 0.01);
    let raw = analyzer.raw_snapshot();
    let index = peak(&raw);
    assert!((raw.pre_db[index] + 40.0).abs() < 0.01);
    let mut fresh = SpectrumAnalyzer::new();
    fresh.configure(analyzer.config()).unwrap();
    measure(&mut fresh, 8192, 48000.0, 1500.0, 0.01);
    assert_eq!(
        analyzer.display_snapshot().pre_db,
        fresh.display_snapshot().pre_db
    );
    assert_eq!(
        analyzer.display_snapshot().post_db,
        fresh.display_snapshot().post_db
    );
    analyzer.reset_sample_rate(96000.0, 8192).expect("rate");
    assert!(!analyzer.ready(8192 + 8191, 8192));
    assert!(analyzer.ready(8192 + 8192, 8192));
    assert_eq!(analyzer.raw_snapshot().sample_rate, 96000.0);
    assert!(analyzer.raw_snapshot().frequency_hz.is_empty());
    assert!(analyzer.display_snapshot().frequency_hz.is_empty());
    measure(&mut analyzer, 16384, 96000.0, 3000.0, 0.25);
    let raw = analyzer.raw_snapshot();
    let index = peak(&raw);
    assert!((raw.frequency_hz[index] - 3000.0).abs() < 60.0);
    assert!((raw.pre_db[index] + 12.0412).abs() < 0.01);
    let mut fresh_rate = SpectrumAnalyzer::new();
    fresh_rate.configure(analyzer.config()).unwrap();
    fresh_rate.reset_sample_rate(96000.0, 8192).unwrap();
    measure(&mut fresh_rate, 16384, 96000.0, 3000.0, 0.25);
    assert_same_spectrum(&analyzer.display_snapshot(), &fresh_rate.display_snapshot());
}

#[test]
fn overwritten_windows_keep_last_good_spectrum_and_invalid_configuration_is_atomic() {
    let mut analyzer = SpectrumAnalyzer::new();
    measure(&mut analyzer, 4096, 48000.0, 750.0, 0.5);
    let before = analyzer.raw_snapshot();
    assert!(!analyzer.capture_window(8192, 48000.0, |sequence| {
        (sequence != 6000).then_some([0.0; 6])
    }));
    let after = analyzer.raw_snapshot();
    assert_eq!(after.pre_db, before.pre_db);
    assert_eq!(after.sequence, before.sequence);
    assert_eq!(after.invalid_windows, 1);
    let original = analyzer.config();
    assert_eq!(
        analyzer.configure(AnalyzerConfig {
            tilt_db_oct: f32::NAN,
            ..original
        }),
        Err(AnalyzerError::InvalidTilt)
    );
    assert_eq!(analyzer.config(), original);
    assert_eq!(
        analyzer.reset_sample_rate(f64::NAN, 8192),
        Err(AnalyzerError::InvalidSampleRate)
    );
    assert_eq!(analyzer.sample_rate(), 48000.0);
}

#[test]
fn failed_partial_window_preserves_fft_used_by_channel_and_instant_display_changes() {
    let mut analyzer = SpectrumAnalyzer::new();
    let mut control = SpectrumAnalyzer::new();
    measure(&mut analyzer, 4096, 48000.0, 750.0, 0.5);
    measure(&mut control, 4096, 48000.0, 750.0, 0.5);
    let raw = analyzer.raw_snapshot();

    assert!(!analyzer.capture_window(8192, 48000.0, |sequence| {
        (sequence != 6000).then_some([1.0, 1.0, 0.5, 0.5, 0.25, 0.25])
    }));
    for (channel, speed) in [
        (EqChannel::Mid, AnalyzerSpeed::Medium),
        (EqChannel::Side, AnalyzerSpeed::Medium),
        (EqChannel::Side, AnalyzerSpeed::Off),
        (EqChannel::Left, AnalyzerSpeed::Off),
    ] {
        let config = AnalyzerConfig {
            channel,
            speed,
            ..AnalyzerConfig::default()
        };
        analyzer.configure(config).unwrap();
        control.configure(config).unwrap();
        let display = analyzer.display_snapshot();
        let expected = control.display_snapshot();
        assert_eq!(display.pre_db, expected.pre_db);
        assert_eq!(display.post_db, expected.post_db);
        assert_eq!(display.external_db, expected.external_db);
        assert_eq!(display.sequence, expected.sequence);
        assert_eq!(display.invalid_windows, 1);

        let after = analyzer.raw_snapshot();
        assert_eq!(after.pre_db, raw.pre_db);
        assert_eq!(after.post_db, raw.post_db);
        assert_eq!(after.external_db, raw.external_db);
        assert_eq!(after.sequence, raw.sequence);
    }
    // The next complete window replaces every staging sample and recovers.
    measure(&mut analyzer, 12288, 48000.0, 1500.0, 0.1);
    measure(&mut control, 12288, 48000.0, 1500.0, 0.1);
    assert_eq!(
        analyzer.display_snapshot().pre_db,
        control.display_snapshot().pre_db
    );
}

#[test]
fn display_channels_project_complex_audio_and_never_change_raw_match_spectrum() {
    let mut analyzer = SpectrumAnalyzer::new();
    analyzer
        .configure(AnalyzerConfig {
            speed: AnalyzerSpeed::Off,
            ..AnalyzerConfig::default()
        })
        .unwrap();
    measure(&mut analyzer, 4096, 48000.0, 750.0, 0.5);
    let raw = analyzer.raw_snapshot();
    let index = peak(&raw);
    let stereo = analyzer.display_snapshot();
    for (channel, expected_db) in [
        (EqChannel::Mid, -120.0),
        (EqChannel::Side, stereo.pre_db[index]),
        (EqChannel::Left, stereo.pre_db[index]),
        (EqChannel::Right, stereo.pre_db[index]),
    ] {
        analyzer
            .configure(AnalyzerConfig {
                channel,
                ..analyzer.config()
            })
            .unwrap();
        assert!((analyzer.display_snapshot().pre_db[index] - expected_db).abs() < 0.01);
        assert_eq!(analyzer.raw_snapshot().pre_db, raw.pre_db);
    }
    analyzer
        .configure(AnalyzerConfig {
            channel: EqChannel::Mid,
            ..analyzer.config()
        })
        .unwrap();
    assert!(analyzer.capture_window(8192, 48000.0, |sequence| {
        let sample = (std::f64::consts::TAU * 750.0 * sequence as f64 / 48000.0).sin() as f32 * 0.5;
        Some([sample, sample, sample, sample, sample, sample])
    }));
    assert!((analyzer.display_snapshot().pre_db[index] - stereo.pre_db[index]).abs() < 0.01);
    analyzer
        .configure(AnalyzerConfig {
            channel: EqChannel::Side,
            ..analyzer.config()
        })
        .unwrap();
    assert_eq!(analyzer.display_snapshot().pre_db[index], -120.0);
}

#[test]
fn low_frequency_display_interpolates_repeated_fft_bins_into_a_continuous_curve() {
    let mut analyzer = SpectrumAnalyzer::new();
    analyzer
        .configure(AnalyzerConfig {
            speed: AnalyzerSpeed::Off,
            ..AnalyzerConfig::default()
        })
        .unwrap();
    measure(&mut analyzer, 4096, 48000.0, 93.75, 0.5);
    let raw = analyzer.raw_snapshot();
    let display = analyzer.display_snapshot();
    let repeats = |values: &[f32]| {
        (1..values.len())
            .filter(|&index| {
                (70.0..120.0).contains(&raw.frequency_hz[index])
                    && (values[index] - values[index - 1]).abs() < 0.0001
            })
            .count()
    };
    assert!(
        repeats(&raw.pre_db) > 10,
        "raw FFT retains its original steps"
    );
    assert_eq!(repeats(&display.pre_db), 0);
}

#[test]
fn log_frequency_smoothing_reduces_noise_jaggedness_and_preserves_pre_post_ratios() {
    let mut analyzer = SpectrumAnalyzer::new();
    analyzer
        .configure(AnalyzerConfig {
            speed: AnalyzerSpeed::Off,
            ..AnalyzerConfig::default()
        })
        .unwrap();
    let mut state = 123_456_789_u32;
    assert!(analyzer.capture_window(4096, 48000.0, |_| {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let noise = (f64::from(state) / f64::from(u32::MAX) * 2.0 - 1.0) as f32 * 0.12;
        Some([
            noise,
            noise,
            noise * 0.5,
            noise * 0.5,
            noise * 0.25,
            noise * 0.25,
        ])
    }));
    let raw = analyzer.raw_snapshot();
    let display = analyzer.display_snapshot();
    let roughness = |values: &[f32]| {
        (1..values.len())
            .filter(|&index| (2000.0..20000.0).contains(&raw.frequency_hz[index]))
            .map(|index| (values[index] - values[index - 1]).powi(2))
            .sum::<f32>()
    };
    assert!(
        roughness(&display.pre_db) < roughness(&raw.pre_db) * 0.5,
        "display should remove narrow noise teeth"
    );
    for index in 0..DISPLAY_BINS {
        assert!((display.post_db[index] - display.pre_db[index] + 6.0206).abs() < 0.01);
        assert!((display.external_db[index] - display.pre_db[index] + 12.0412).abs() < 0.01);
    }
    analyzer
        .configure(AnalyzerConfig {
            tilt_db_oct: 4.5,
            ..analyzer.config()
        })
        .unwrap();
    let tilted = analyzer.display_snapshot();
    for index in 0..DISPLAY_BINS {
        let expected_tilt = 4.5 * (raw.frequency_hz[index] / 1000.0).log2();
        assert!((tilted.pre_db[index] - display.pre_db[index] - expected_tilt).abs() < 0.001);
    }
    let after = analyzer.raw_snapshot();
    assert_eq!(after.pre_db, raw.pre_db);
    assert_eq!(after.post_db, raw.post_db);
    assert_eq!(after.external_db, raw.external_db);
}

#[test]
fn spatial_rounding_keeps_isolated_tone_peaks_at_their_measured_frequencies() {
    for resolution in [
        AnalyzerResolution::Low,
        AnalyzerResolution::High,
        AnalyzerResolution::Maximum,
    ] {
        for frequency in [93.75, 750.0, 6000.0, 18000.0] {
            let mut analyzer = SpectrumAnalyzer::new();
            analyzer
                .configure(AnalyzerConfig {
                    resolution,
                    speed: AnalyzerSpeed::Off,
                    ..AnalyzerConfig::default()
                })
                .unwrap();
            measure(
                &mut analyzer,
                resolution.fft_size() as u64,
                48000.0,
                frequency,
                0.5,
            );
            let display = analyzer.display_snapshot();
            let measured = f64::from(display.frequency_hz[peak(&display)]);
            let tolerance = 48000.0 / resolution.fft_size() as f64 + frequency * 0.02;
            assert!(
                (measured - frequency).abs() < tolerance,
                "rounded {frequency} Hz peak moved to {measured} Hz at {resolution:?}"
            );
            let index = peak(&display);
            assert!((display.post_db[index] - display.pre_db[index] + 6.0206).abs() < 0.01);
        }
    }
}
