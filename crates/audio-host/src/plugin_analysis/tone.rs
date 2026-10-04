use super::{
    AtomicBool, Chain, Ordering, PluginAnalysisDistortion, PluginAnalysisFailure,
    PluginAnalysisHarmonics, PluginAnalysisOscilloscope, PluginAnalysisOscilloscopeWaveform,
    PluginAnalysisSpectrum, StereoRoute, lock_in, signal,
};

impl Chain {
    pub(super) fn harmonics(
        &mut self,
        route: StereoRoute,
    ) -> Result<PluginAnalysisHarmonics, PluginAnalysisFailure> {
        let mut report = PluginAnalysisHarmonics {
            channel: route.index(),
            frequency_hz: Vec::new(),
            orders_db: vec![Vec::new(); 7],
            thd_percent: Vec::new(),
            fundamental_gain_db: Vec::new(),
        };
        let peak = 10_f64.powf(self.settings.level_dbfs / 20.0);
        let rate = f64::from(self.settings.sample_rate);
        for index in 0..36 {
            self.settle()?;
            let hz = self.settings.start_hz
                * (self.settings.end_hz / self.settings.start_hz).powf(index as f64 / 35.0);
            // At least 8 cycles and 4 blocks, on an exact DFT bin for leakage-free lock-in.
            let length = ((rate * 10.0 / hz).ceil() as usize).max(self.settings.fft_size as usize);
            let cycles = (hz * length as f64 / rate).round().max(1.0);
            let measured_hz = cycles * rate / length as f64;
            let latency = (self.settings.tail_seconds * rate) as usize;
            let warmup = length.max(latency);
            let input: Vec<_> = (0..warmup + length)
                .map(|i| peak * (std::f64::consts::TAU * measured_hz * i as f64 / rate).sin())
                .collect();
            let output = self.capture_route(&input, route, 0, false)?;
            let samples = &output[warmup..];
            let amplitude = |order: usize| {
                let mut re = 0.0;
                let mut im = 0.0;
                for (i, frame) in samples.iter().enumerate() {
                    let value = route.measure(*frame);
                    let phase =
                        std::f64::consts::TAU * cycles * order as f64 * i as f64 / length as f64;
                    re += value * phase.cos();
                    im += value * phase.sin();
                }
                re.hypot(im) * 2.0 / length as f64
            };
            let fundamental = amplitude(1);
            report
                .fundamental_gain_db
                .push((fundamental > 1e-10).then(|| 20.0 * (fundamental / peak).log10()));
            let mut power = 0.0;
            for order in 2..=8 {
                let value = (measured_hz * (order as f64) < rate * 0.5 && fundamental > 1e-10)
                    .then(|| {
                        let ratio = amplitude(order) / fundamental;
                        power += ratio * ratio;
                        20.0 * ratio.max(1e-12).log10()
                    });
                report.orders_db[order - 2].push(value);
            }
            report.frequency_hz.push(measured_hz);
            report.thd_percent.push(
                (fundamental > 1e-10 && measured_hz * 2.0 < rate * 0.5)
                    .then(|| power.sqrt() * 100.0),
            );
        }
        Ok(report)
    }

    pub(super) fn distortion(
        &mut self,
        route: StereoRoute,
    ) -> Result<PluginAnalysisDistortion, PluginAnalysisFailure> {
        let rate = f64::from(self.settings.sample_rate);
        let peak = 10_f64.powf(self.settings.level_dbfs / 20.0);
        let latency = (self.settings.tail_seconds * rate) as usize;

        // Single tone, quantized to an exact DFT bin so the lock-in is leakage free.
        self.settle()?;
        let tone_hz = self.settings.tone_hz;
        let length = ((rate * 10.0 / tone_hz).ceil() as usize).max(self.settings.fft_size as usize);
        let cycles = (tone_hz * length as f64 / rate).round().max(1.0);
        let measured_hz = cycles * rate / length as f64;
        let warmup = length.max(latency);
        let input: Vec<f64> = (0..warmup + length)
            .map(|index| peak * (std::f64::consts::TAU * measured_hz * index as f64 / rate).sin())
            .collect();
        let output = self.capture_route(&input, route, 0, false)?;
        let samples: Vec<f64> = output[warmup..]
            .iter()
            .map(|frame| route.measure(*frame))
            .collect();
        let tone_spectrum = spectrum_report(
            &samples,
            rate,
            self.settings.fft_size as usize,
            &self.cancel,
        )?;
        let fundamental = lock_in(&samples, cycles, 1, length);
        let maximum_order = (rate * 0.5 / measured_hz).floor() as usize;
        let mut harmonic_power = 0.0;
        for order in 2..=maximum_order.min(64) {
            let ratio = lock_in(&samples, cycles, order, length) / fundamental.max(1e-20);
            harmonic_power += ratio * ratio;
        }
        let thd_percent = (fundamental > 1e-10).then(|| harmonic_power.sqrt() * 100.0);
        let total_rms =
            (samples.iter().map(|value| value * value).sum::<f64>() / samples.len() as f64).sqrt();
        let fundamental_rms = fundamental / std::f64::consts::SQRT_2;
        let noise_rms = (total_rms * total_rms - fundamental_rms * fundamental_rms)
            .max(0.0)
            .sqrt();
        let thd_plus_n_percent =
            (fundamental_rms > 1e-12).then(|| noise_rms / fundamental_rms * 100.0);

        // Two-tone IMD: 60 Hz at the configured level and 7000 Hz 12 dB lower.
        // A length that is a multiple of sample_rate/20 puts both carriers and
        // every 60 Hz modulation product on exact bins.
        let low_hz = 60.0;
        let high_hz = 7000.0;
        let mut imd_spectrum = PluginAnalysisSpectrum {
            frequency_hz: Vec::new(),
            magnitude_dbfs: Vec::new(),
        };
        let imd_percent = if high_hz * 1.9 < rate {
            self.settle()?;
            let length = (rate / 20.0 * 8.0).round() as usize;
            let spacing = low_hz * length as f64 / rate;
            let low_cycles = (low_hz * length as f64 / rate).round().max(1.0);
            let high_cycles = (high_hz * length as f64 / rate).round().max(1.0);
            let low_measured = low_cycles * rate / length as f64;
            let high_measured = high_cycles * rate / length as f64;
            let warmup = length.max(latency);
            let high_peak = peak * 10_f64.powf(-12.0 / 20.0);
            let input: Vec<f64> = (0..warmup + length)
                .map(|index| {
                    let time = index as f64 / rate;
                    peak * (std::f64::consts::TAU * low_measured * time).sin()
                        + high_peak * (std::f64::consts::TAU * high_measured * time).sin()
                })
                .collect();
            let output = self.capture_route(&input, route, 0, false)?;
            let samples: Vec<f64> = output[warmup..]
                .iter()
                .map(|frame| route.measure(*frame))
                .collect();
            imd_spectrum = spectrum_report(
                &samples,
                rate,
                self.settings.fft_size as usize,
                &self.cancel,
            )?;
            let carrier = lock_in(&samples, high_cycles, 1, length);
            let mut power = 0.0;
            for side in 1..=10usize {
                for sign in [-1.0_f64, 1.0] {
                    let sideband = high_cycles + sign * spacing * side as f64;
                    if sideband <= 0.0 {
                        continue;
                    }
                    let amplitude = lock_in(&samples, sideband, 1, length);
                    power += (amplitude / carrier.max(1e-20)).powi(2);
                }
            }
            (carrier > 1e-10).then(|| power.sqrt() * 100.0)
        } else {
            None
        };

        Ok(PluginAnalysisDistortion {
            channel: route.index(),
            tone_hz: measured_hz,
            thd_percent,
            thd_plus_n_percent,
            imd_percent,
            tone_spectrum,
            imd_spectrum,
        })
    }

    pub(super) fn oscilloscope(
        &mut self,
        route: StereoRoute,
        latency: u32,
    ) -> Result<PluginAnalysisOscilloscope, PluginAnalysisFailure> {
        let rate = f64::from(self.settings.sample_rate);
        let peak = 10_f64.powf(self.settings.level_dbfs / 20.0);
        let period = ((rate / self.settings.tone_hz).round() as usize).max(2);
        let cycles = 4usize;
        let length = period * cycles;
        let warmup = length.max((self.settings.tail_seconds * rate) as usize);
        let points = 400usize;
        let stride = length.div_ceil(points).max(1);
        let shape = |phase: f64, kind: &str| match kind {
            "square" => {
                if phase < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            "saw" => 2.0 * phase - 1.0,
            "triangle" => 1.0 - 4.0 * (phase - 0.5).abs(),
            _ => (std::f64::consts::TAU * phase).sin(),
        };
        let mut waveforms = Vec::with_capacity(4);
        for kind in ["sine", "square", "saw", "triangle"] {
            self.settle()?;
            let input: Vec<f64> = (0..warmup + length)
                .map(|index| peak * shape((index % period) as f64 / period as f64, kind))
                .collect();
            let output = self.capture_route(&input, route, 0, false)?;
            let measured: Vec<f64> = output[warmup..]
                .iter()
                .map(|frame| route.measure(*frame))
                .collect();
            waveforms.push(PluginAnalysisOscilloscopeWaveform {
                waveform: kind.to_owned(),
                input: input[warmup..].iter().step_by(stride).copied().collect(),
                output: measured.iter().step_by(stride).copied().collect(),
            });
        }
        Ok(PluginAnalysisOscilloscope {
            channel: route.index(),
            sample_rate: rate,
            sample_stride: stride as u32,
            duration_seconds: length as f64 / rate,
            delay_samples: latency,
            waveforms,
        })
    }
}

/// Hann-windowed, power-averaged spectrum. Keep every positive FFT bin so
/// narrow harmonics, aliases and IMD sidebands survive the report boundary.
fn spectrum_report(
    samples: &[f64],
    rate: f64,
    size: usize,
    cancel: &AtomicBool,
) -> Result<PluginAnalysisSpectrum, PluginAnalysisFailure> {
    let window: Vec<_> = (0..size)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / size as f64).cos())
        .collect();
    let sum = window.iter().sum::<f64>();
    let mut power = vec![0.0; size / 2 + 1];
    let mut windows = 0;
    for start in (0..samples.len()).step_by(size / 2) {
        if windows > 0 && start + size > samples.len() {
            break;
        }
        if cancel.load(Ordering::Acquire) {
            return Err(PluginAnalysisFailure::Cancelled);
        }
        let values: Vec<_> = window
            .iter()
            .enumerate()
            .map(|(i, w)| samples.get(start + i).copied().unwrap_or_default() * w)
            .collect();
        let bins = signal::spectrum(&values, size);
        for (i, value) in power.iter_mut().enumerate() {
            let factor = if i == 0 || i == size / 2 { 1.0 } else { 2.0 };
            *value += (bins[i].norm() * factor / sum).powi(2);
        }
        windows += 1;
    }
    Ok(PluginAnalysisSpectrum {
        frequency_hz: (0..power.len())
            .map(|i| i as f64 * rate / size as f64)
            .collect(),
        magnitude_dbfs: power
            .into_iter()
            .map(|v| 10.0 * (v / windows.max(1) as f64).max(1e-20).log10())
            .collect(),
    })
}
