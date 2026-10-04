mod model;
mod signal;
mod spectrogram;
#[cfg(test)]
mod tests;

use heron_audio_plugin::{
    AudioPluginProcessorHandle, AudioPortToken, PluginProcessFailure, ProcessContext,
    SidechainSource,
};
use heron_dsp_runtime::protocol::{
    PluginAnalysisDistortion, PluginAnalysisDynamics, PluginAnalysisDynamicsPoint,
    PluginAnalysisFailure, PluginAnalysisHarmonics, PluginAnalysisJobStatus,
    PluginAnalysisOscilloscope, PluginAnalysisOscilloscopeWaveform, PluginAnalysisPerformance,
    PluginAnalysisReport, PluginAnalysisSettings,
};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

struct EmptySidechains;
impl SidechainSource for EmptySidechains {
    fn frames(&self, _: AudioPortToken) -> Option<&[[f32; 2]]> {
        None
    }
}

/// Selects how a mono excitation drives the stereo input and how the stereo
/// output is folded back to one measurement channel.
#[derive(Clone, Copy)]
enum StereoRoute {
    Channel(usize),
    Mid,
    Side,
}

impl StereoRoute {
    fn gains(self) -> (f64, f64) {
        match self {
            Self::Channel(0) => (1.0, 0.0),
            Self::Channel(_) => (0.0, 1.0),
            Self::Mid => (1.0, 1.0),
            Self::Side => (1.0, -1.0),
        }
    }

    fn measure(self, frame: [f64; 2]) -> f64 {
        match self {
            Self::Channel(channel) => frame[channel],
            Self::Mid => 0.5 * (frame[0] + frame[1]),
            Self::Side => 0.5 * (frame[0] - frame[1]),
        }
    }

    fn index(self) -> u32 {
        match self {
            Self::Channel(0) | Self::Mid => 0,
            Self::Channel(_) | Self::Side => 1,
        }
    }
}

/// Amplitude at `order * cycles` for a capture that is an exact number of cycles
/// long, so the single-bin lock-in is leakage free.
fn lock_in(samples: &[f64], cycles: f64, order: usize, length: usize) -> f64 {
    let mut real = 0.0;
    let mut imaginary = 0.0;
    for (index, sample) in samples.iter().enumerate() {
        let phase = std::f64::consts::TAU * cycles * order as f64 * index as f64 / length as f64;
        real += sample * phase.cos();
        imaginary += sample * phase.sin();
    }
    real.hypot(imaginary) * 2.0 / length as f64
}

struct Chain {
    processors: Vec<AudioPluginProcessorHandle>,
    settings: PluginAnalysisSettings,
    cancel: Arc<AtomicBool>,
    clock: i64,
    times: Vec<f64>,
}

impl Drop for Chain {
    fn drop(&mut self) {
        for processor in &mut self.processors {
            processor.retire();
        }
    }
}

impl Chain {
    fn capture(
        &mut self,
        input: &[f64],
        channel: usize,
        tail: usize,
        timed: bool,
    ) -> Result<Vec<[f64; 2]>, PluginAnalysisFailure> {
        self.capture_route(input, StereoRoute::Channel(channel), tail, timed)
    }

    fn capture_route(
        &mut self,
        input: &[f64],
        route: StereoRoute,
        tail: usize,
        timed: bool,
    ) -> Result<Vec<[f64; 2]>, PluginAnalysisFailure> {
        let (left_gain, right_gain) = route.gains();
        let total = input.len() + tail;
        let mut output = Vec::with_capacity(total);
        let mut block = vec![[0.0_f32; 2]; self.settings.block_size as usize];
        for offset in (0..total).step_by(block.len()) {
            if self.cancel.load(Ordering::Acquire) {
                return Err(PluginAnalysisFailure::Cancelled);
            }
            let count = (total - offset).min(block.len());
            for (i, frame) in block.iter_mut().enumerate() {
                let value = input.get(offset + i).copied().unwrap_or_default() as f32;
                *frame = [value * left_gain as f32, value * right_gain as f32];
            }
            let context = ProcessContext {
                project_time_samples: self.clock,
                continuous_time_samples: self.clock,
                steady_time_samples: self.clock,
                project_time_quarters: self.clock as f64 / f64::from(self.settings.sample_rate)
                    * 2.0,
                bar_position_quarters: 0.0,
                tempo: 120.0,
                time_signature_numerator: 4,
                time_signature_denominator: 4,
                playing: true,
                recording: false,
                loop_active: false,
                loop_start_quarters: 0.0,
                loop_end_quarters: 0.0,
            };
            let started = Instant::now();
            for processor in &mut self.processors {
                if !processor.process_block(&mut block, &EmptySidechains, &context) {
                    return Err(
                        if processor
                            .take_unreported_process_failure()
                            .is_some_and(|failure| {
                                failure.failure == PluginProcessFailure::InvalidOutput
                            })
                        {
                            PluginAnalysisFailure::InvalidOutput
                        } else {
                            PluginAnalysisFailure::ProcessorRejected
                        },
                    );
                }
            }
            if timed {
                self.times.push(started.elapsed().as_secs_f64() * 1e6);
            }
            if block
                .iter()
                .any(|frame| frame.iter().any(|v| !v.is_finite()))
            {
                return Err(PluginAnalysisFailure::InvalidOutput);
            }
            output.extend(
                block[..count]
                    .iter()
                    .map(|f| [f64::from(f[0]), f64::from(f[1])]),
            );
            self.clock += block.len() as i64;
        }
        Ok(output)
    }

    fn settle(&mut self) -> Result<(), PluginAnalysisFailure> {
        let count = (self.settings.tail_seconds * f64::from(self.settings.sample_rate)) as usize;
        self.capture(&[], 0, count, false).map(|_| ())
    }

    fn harmonics(
        &mut self,
        route: StereoRoute,
    ) -> Result<PluginAnalysisHarmonics, PluginAnalysisFailure> {
        let mut report = PluginAnalysisHarmonics {
            channel: route.index(),
            frequency_hz: Vec::new(),
            orders_db: vec![Vec::new(); 7],
            thd_percent: Vec::new(),
        };
        let peak = 10_f64.powf(self.settings.level_dbfs / 20.0);
        let rate = f64::from(self.settings.sample_rate);
        for index in 0..36 {
            self.settle()?;
            let hz = self.settings.start_hz
                * (self.settings.end_hz / self.settings.start_hz).powf(index as f64 / 35.0);
            // At least 8 cycles and 4 blocks, on an exact DFT bin for leakage-free lock-in.
            let length =
                ((rate * 8.0 / hz).ceil() as usize).max(self.settings.block_size as usize * 4);
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

    fn distortion(
        &mut self,
        route: StereoRoute,
    ) -> Result<PluginAnalysisDistortion, PluginAnalysisFailure> {
        let rate = f64::from(self.settings.sample_rate);
        let peak = 10_f64.powf(self.settings.level_dbfs / 20.0);
        let latency = (self.settings.tail_seconds * rate) as usize;

        // Single tone, quantized to an exact DFT bin so the lock-in is leakage free.
        self.settle()?;
        let tone_hz = self.settings.tone_hz;
        let length =
            ((rate * 8.0 / tone_hz).ceil() as usize).max(self.settings.block_size as usize * 4);
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
        })
    }

    fn oscilloscope(
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
            let stride = measured.len().div_ceil(points).max(1);
            waveforms.push(PluginAnalysisOscilloscopeWaveform {
                waveform: kind.to_owned(),
                input: input[warmup..].iter().step_by(stride).copied().collect(),
                output: measured.iter().step_by(stride).copied().collect(),
            });
        }
        Ok(PluginAnalysisOscilloscope {
            channel: route.index(),
            sample_rate: rate,
            duration_seconds: cycles as f64 / self.settings.tone_hz,
            delay_samples: latency,
            waveforms,
        })
    }

    fn dynamics(
        &mut self,
        route: StereoRoute,
    ) -> Result<PluginAnalysisDynamics, PluginAnalysisFailure> {
        let rate = f64::from(self.settings.sample_rate);
        let hz = self.settings.tone_hz;
        let measurement = (rate * 0.2) as usize;
        let mut ramp = Vec::new();
        let mut level = -100.0_f64;
        while level <= 0.0 {
            let peak = 10_f64.powf(level / 20.0);
            self.settle()?;
            let input: Vec<f64> = (0..measurement)
                .map(|index| peak * (std::f64::consts::TAU * hz * index as f64 / rate).sin())
                .collect();
            let output = self.capture_route(&input, route, 0, false)?;
            let maximum = output
                .iter()
                .map(|frame| route.measure(*frame).abs())
                .fold(0.0_f64, f64::max);
            ramp.push(PluginAnalysisDynamicsPoint {
                input_dbfs: level,
                output_dbfs: 20.0 * maximum.max(1e-12).log10(),
            });
            level += 5.0;
        }
        // Attack/release: three equal segments at -60, 0 and -60 dBFS peak.
        let step_seconds = 0.2_f64;
        let segment = (rate * step_seconds) as usize;
        self.settle()?;
        let mut input = Vec::with_capacity(segment * 3);
        for level in [-60.0_f64, 0.0, -60.0] {
            let peak = 10_f64.powf(level / 20.0);
            input.extend(
                (0..segment)
                    .map(|index| peak * (std::f64::consts::TAU * hz * index as f64 / rate).sin()),
            );
        }
        let output = self.capture_route(&input, route, 0, false)?;
        let measured: Vec<f64> = output.iter().map(|frame| route.measure(*frame)).collect();
        let points = 400usize;
        let bin = measured.len().div_ceil(points).max(1);
        let mut time_seconds = Vec::new();
        let mut input_envelope = Vec::new();
        let mut output_envelope = Vec::new();
        for index in 0..points {
            let start = index * bin;
            if start >= measured.len() {
                break;
            }
            let end = (start + bin).min(measured.len());
            time_seconds.push(start as f64 / rate);
            input_envelope.push(
                input[start..end]
                    .iter()
                    .map(|value| value.abs())
                    .fold(0.0_f64, f64::max),
            );
            output_envelope.push(
                measured[start..end]
                    .iter()
                    .map(|value| value.abs())
                    .fold(0.0_f64, f64::max),
            );
        }
        Ok(PluginAnalysisDynamics {
            channel: route.index(),
            ramp,
            time_seconds,
            input_envelope,
            output_envelope,
            step_seconds,
        })
    }
}

fn analyze(
    mut chain: Chain,
    latency: u32,
    status: &Mutex<PluginAnalysisJobStatus>,
) -> Result<PluginAnalysisReport, PluginAnalysisFailure> {
    let update = |phase: &str, progress: f64| {
        if let Ok(mut value) = status.lock() {
            *value = PluginAnalysisJobStatus::Running {
                phase: phase.to_owned(),
                progress,
            };
        }
    };
    let settings = chain.settings.clone();
    let excitation = signal::sweep(&settings);
    let tail = (settings.tail_seconds * f64::from(settings.sample_rate)) as usize;
    let peak = 10_f64.powf(settings.level_dbfs / 20.0);
    let mut responses = Vec::new();
    let mut harmonics = Vec::new();
    let mut spectrograms = Vec::new();
    let mut distortion = Vec::new();
    let mut oscilloscopes = Vec::new();
    let mut dynamics = Vec::new();
    let mut models = Vec::new();
    let routes: [StereoRoute; 2] = if settings.mid_side {
        [StereoRoute::Mid, StereoRoute::Side]
    } else {
        [StereoRoute::Channel(0), StereoRoute::Channel(1)]
    };
    for (index, source) in routes.into_iter().enumerate() {
        update("linear", index as f64 * 0.5);
        chain.settle()?;
        let silence = chain.capture_route(&[], source, settings.block_size as usize * 8, false)?;
        let output = chain.capture_route(&excitation, source, tail, true)?;
        chain.settle()?;
        let repeated = chain.capture_route(&excitation, source, tail, true)?;
        let measured: Vec<f64> = output.iter().map(|frame| source.measure(*frame)).collect();
        for destination in routes {
            if chain.cancel.load(Ordering::Acquire) {
                return Err(PluginAnalysisFailure::Cancelled);
            }
            let destination_measured: Vec<f64> = output
                .iter()
                .map(|frame| destination.measure(*frame))
                .collect();
            let destination_repeated: Vec<f64> = repeated
                .iter()
                .map(|frame| destination.measure(*frame))
                .collect();
            let mut response = signal::response(
                &excitation,
                &destination_measured,
                &settings,
                source.index(),
                destination.index(),
            );
            response.silence_rms = (silence
                .iter()
                .map(|frame| destination.measure(*frame).powi(2))
                .sum::<f64>()
                / silence.len() as f64)
                .sqrt();
            let energy = destination_measured
                .iter()
                .map(|value| value.powi(2))
                .sum::<f64>();
            response.repeat_error_percent = (destination_measured
                .iter()
                .zip(&destination_repeated)
                .map(|(a, b)| (a - b).powi(2))
                .sum::<f64>()
                / energy.max(1e-20))
            .sqrt()
                * 100.0;
            responses.push(response);
        }
        update("harmonics", 0.15 + index as f64 * 0.5);
        spectrograms.push(spectrogram::measure(
            &measured,
            &settings,
            source.index(),
            true,
            &chain.cancel,
        )?);
        chain.settle()?;
        let linear_sweep = spectrogram::linear_sweep(&settings);
        let linear_output = chain.capture_route(&linear_sweep, source, tail, false)?;
        let linear_measured: Vec<f64> = linear_output
            .iter()
            .map(|frame| source.measure(*frame))
            .collect();
        spectrograms.push(spectrogram::measure(
            &linear_measured,
            &settings,
            source.index(),
            false,
            &chain.cancel,
        )?);
        harmonics.push(chain.harmonics(source)?);
        update("model", 0.3 + index as f64 * 0.5);
        chain.settle()?;
        let training = signal::noise(32768, 0x81723, peak);
        let training_output = chain.capture_route(&training, source, tail, false)?;
        chain.settle()?;
        let validation = signal::noise(16384, 0x17384, peak);
        let validation_output = chain.capture_route(&validation, source, tail, false)?;
        models.push(model::fit(
            model::FitData {
                channel: source.index(),
                input: &training,
                output: &training_output
                    .iter()
                    .map(|frame| source.measure(*frame))
                    .collect::<Vec<_>>(),
                validation_input: &validation,
                validation_output: &validation_output
                    .iter()
                    .map(|frame| source.measure(*frame))
                    .collect::<Vec<_>>(),
                scale: peak,
                delay: latency,
                order: settings.model_order,
            },
            &chain.cancel,
        )?);
        distortion.push(chain.distortion(source)?);
        oscilloscopes.push(chain.oscilloscope(source, latency)?);
        dynamics.push(chain.dynamics(source)?);
        if chain.cancel.load(Ordering::Acquire) {
            return Err(PluginAnalysisFailure::Cancelled);
        }
    }
    let times = &mut chain.times;
    let average = times.iter().sum::<f64>() / times.len().max(1) as f64;
    times.sort_by(f64::total_cmp);
    let percentile = |q: f64| {
        times
            .get(((times.len().saturating_sub(1)) as f64 * q).ceil() as usize)
            .copied()
            .unwrap_or_default()
    };
    let budget = f64::from(settings.block_size) / f64::from(settings.sample_rate) * 1e6;
    let fft_size = ((excitation.len() + tail) * 2).next_power_of_two();
    let performance = PluginAnalysisPerformance {
        reported_latency_samples: latency,
        average_block_us: average,
        p95_block_us: percentile(0.95),
        p99_block_us: percentile(0.99),
        maximum_block_us: percentile(1.0),
        budget_us: budget,
        deadline_misses: times.iter().filter(|t| **t > budget).count() as u32,
        measured_blocks: times.len() as u32,
        buffer_bytes: (fft_size * 16 * 4
            + (excitation.len() + tail) * 24
            + spectrograms
                .iter()
                .map(|s| s.magnitude_dbfs.len() * size_of::<f32>())
                .sum::<usize>()) as u64,
    };
    // Cross-channel processing cannot be represented by independent SISO models.
    for model in &mut models {
        let cross = &responses[model.channel as usize * 2 + (1 - model.channel as usize)];
        let direct = &responses[model.channel as usize * 2 + model.channel as usize];
        if cross
            .magnitude_db
            .iter()
            .zip(&direct.magnitude_db)
            .any(|(cross, direct)| *cross > *direct - 40.0)
        {
            model.suitable = false;
        }
    }
    Ok(PluginAnalysisReport {
        settings,
        responses,
        harmonics,
        spectrograms,
        distortion,
        oscilloscopes,
        dynamics,
        models,
        performance,
    })
}

struct Job {
    cancel: Arc<AtomicBool>,
    status: Arc<Mutex<PluginAnalysisJobStatus>>,
    worker: std::thread::JoinHandle<()>,
}

#[derive(Default)]
pub(crate) struct PluginAnalysisJobs {
    jobs: Mutex<HashMap<String, Job>>,
}

impl PluginAnalysisJobs {
    pub(crate) fn start(
        &self,
        id: String,
        processors: Vec<AudioPluginProcessorHandle>,
        settings: PluginAnalysisSettings,
        latency: u32,
    ) -> PluginAnalysisJobStatus {
        let Ok(mut jobs) = self.jobs.lock() else {
            return failed(PluginAnalysisFailure::WorkerUnavailable);
        };
        if let Some(job) = jobs.get(&id) {
            return job
                .status
                .lock()
                .map(|v| v.clone())
                .unwrap_or_else(|_| failed(PluginAnalysisFailure::WorkerUnavailable));
        }
        if !settings.valid()
            || latency as f64 >= settings.tail_seconds * f64::from(settings.sample_rate)
        {
            return failed(PluginAnalysisFailure::InvalidSettings);
        }
        if !jobs.is_empty() {
            return failed(PluginAnalysisFailure::Busy);
        }
        let initial = PluginAnalysisJobStatus::Running {
            phase: "preparing".to_owned(),
            progress: 0.0,
        };
        let status = Arc::new(Mutex::new(initial.clone()));
        let cancel = Arc::new(AtomicBool::new(false));
        let chain = Chain {
            processors,
            settings,
            cancel: Arc::clone(&cancel),
            clock: 0,
            times: Vec::new(),
        };
        let worker_status = Arc::clone(&status);
        let worker = std::thread::Builder::new()
            .name("heron-plugin-analysis".to_owned())
            .spawn(move || {
                let result = analyze(chain, latency, &worker_status);
                if let Ok(mut value) = worker_status.lock() {
                    *value = match result {
                        Ok(report) => PluginAnalysisJobStatus::Completed {
                            report: Box::new(report),
                        },
                        Err(failure) => failed(failure),
                    };
                }
            });
        let Ok(worker) = worker else {
            return failed(PluginAnalysisFailure::WorkerUnavailable);
        };
        jobs.insert(
            id,
            Job {
                cancel,
                status,
                worker,
            },
        );
        initial
    }

    pub(crate) fn status(&self, id: &str, cancel: bool, release: bool) -> PluginAnalysisJobStatus {
        let Ok(mut jobs) = self.jobs.lock() else {
            return failed(PluginAnalysisFailure::WorkerUnavailable);
        };
        let Some(job) = jobs.get(id) else {
            return failed(PluginAnalysisFailure::MissingJob);
        };
        if cancel {
            job.cancel.store(true, Ordering::Release);
        }
        let value = job
            .status
            .lock()
            .map(|mut s| {
                if matches!(*s, PluginAnalysisJobStatus::Running { .. }) && job.worker.is_finished()
                {
                    *s = failed(PluginAnalysisFailure::WorkerUnavailable);
                }
                s.clone()
            })
            .unwrap_or_else(|_| failed(PluginAnalysisFailure::WorkerUnavailable));
        if release
            && !matches!(value, PluginAnalysisJobStatus::Running { .. })
            && let Some(job) = jobs.remove(id)
        {
            let _ = job.worker.join();
        }
        value
    }
}

impl Drop for PluginAnalysisJobs {
    fn drop(&mut self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            for job in jobs.values() {
                job.cancel.store(true, Ordering::Release);
            }
            // Runtime teardown retains ownership until every measurement endpoint
            // has been retired on its processing thread, including quarantined jobs.
            for (_, job) in jobs.drain() {
                let _ = job.worker.join();
            }
        }
    }
}

pub(crate) fn failed(failure: PluginAnalysisFailure) -> PluginAnalysisJobStatus {
    PluginAnalysisJobStatus::Failed { failure }
}
