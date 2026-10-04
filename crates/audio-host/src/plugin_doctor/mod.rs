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
    DoctorFailure, DoctorHarmonics, DoctorJobStatus, DoctorPerformance, DoctorReport,
    DoctorSettings,
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

struct Chain {
    processors: Vec<AudioPluginProcessorHandle>,
    settings: DoctorSettings,
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
    ) -> Result<Vec<[f64; 2]>, DoctorFailure> {
        let total = input.len() + tail;
        let mut output = Vec::with_capacity(total);
        let mut block = vec![[0.0_f32; 2]; self.settings.block_size as usize];
        for offset in (0..total).step_by(block.len()) {
            if self.cancel.load(Ordering::Acquire) {
                return Err(DoctorFailure::Cancelled);
            }
            let count = (total - offset).min(block.len());
            for (i, frame) in block.iter_mut().enumerate() {
                *frame = [0.0; 2];
                frame[channel] = input.get(offset + i).copied().unwrap_or_default() as f32;
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
                            DoctorFailure::InvalidOutput
                        } else {
                            DoctorFailure::ProcessorRejected
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
                return Err(DoctorFailure::InvalidOutput);
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

    fn settle(&mut self) -> Result<(), DoctorFailure> {
        let count = (self.settings.tail_seconds * f64::from(self.settings.sample_rate)) as usize;
        self.capture(&[], 0, count, false).map(|_| ())
    }

    fn harmonics(&mut self, channel: usize) -> Result<DoctorHarmonics, DoctorFailure> {
        let mut report = DoctorHarmonics {
            channel: channel as u32,
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
            let output = self.capture(&input, channel, 0, false)?;
            let samples = &output[warmup..];
            let amplitude = |order: usize| {
                let mut re = 0.0;
                let mut im = 0.0;
                for (i, frame) in samples.iter().enumerate() {
                    let phase =
                        std::f64::consts::TAU * cycles * order as f64 * i as f64 / length as f64;
                    re += frame[channel] * phase.cos();
                    im += frame[channel] * phase.sin();
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
}

fn analyze(
    mut chain: Chain,
    latency: u32,
    status: &Mutex<DoctorJobStatus>,
) -> Result<DoctorReport, DoctorFailure> {
    let update = |phase: &str, progress: f64| {
        if let Ok(mut value) = status.lock() {
            *value = DoctorJobStatus::Running {
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
    let mut models = Vec::new();
    for channel in 0..2 {
        update("linear", channel as f64 * 0.5);
        chain.settle()?;
        let silence = chain.capture(&[], channel, settings.block_size as usize * 8, false)?;
        let output = chain.capture(&excitation, channel, tail, true)?;
        chain.settle()?;
        let repeated = chain.capture(&excitation, channel, tail, true)?;
        for destination in 0..2 {
            if chain.cancel.load(Ordering::Acquire) {
                return Err(DoctorFailure::Cancelled);
            }
            let mut response = signal::response(
                &excitation,
                &output.iter().map(|f| f[destination]).collect::<Vec<_>>(),
                &settings,
                channel as u32,
                destination as u32,
            );
            response.silence_rms = (silence.iter().map(|f| f[destination].powi(2)).sum::<f64>()
                / silence.len() as f64)
                .sqrt();
            let energy = output.iter().map(|f| f[destination].powi(2)).sum::<f64>();
            response.repeat_error_percent = (output
                .iter()
                .zip(&repeated)
                .map(|(a, b)| (a[destination] - b[destination]).powi(2))
                .sum::<f64>()
                / energy.max(1e-20))
            .sqrt()
                * 100.0;
            responses.push(response);
        }
        update("harmonics", 0.15 + channel as f64 * 0.5);
        spectrograms.push(spectrogram::measure(
            &output,
            &settings,
            channel,
            true,
            &chain.cancel,
        )?);
        chain.settle()?;
        let linear_sweep = spectrogram::linear_sweep(&settings);
        let linear_output = chain.capture(&linear_sweep, channel, tail, false)?;
        spectrograms.push(spectrogram::measure(
            &linear_output,
            &settings,
            channel,
            false,
            &chain.cancel,
        )?);
        harmonics.push(chain.harmonics(channel)?);
        update("model", 0.3 + channel as f64 * 0.5);
        chain.settle()?;
        let training = signal::noise(32768, 0x81723, peak);
        let training_output = chain.capture(&training, channel, tail, false)?;
        chain.settle()?;
        let validation = signal::noise(16384, 0x17384, peak);
        let validation_output = chain.capture(&validation, channel, tail, false)?;
        models.push(model::fit(
            model::FitData {
                channel: channel as u32,
                input: &training,
                output: &training_output
                    .iter()
                    .map(|f| f[channel])
                    .collect::<Vec<_>>(),
                validation_input: &validation,
                validation_output: &validation_output
                    .iter()
                    .map(|f| f[channel])
                    .collect::<Vec<_>>(),
                scale: peak,
                delay: latency,
            },
            &chain.cancel,
        )?);
        if chain.cancel.load(Ordering::Acquire) {
            return Err(DoctorFailure::Cancelled);
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
    let performance = DoctorPerformance {
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
    Ok(DoctorReport {
        settings,
        responses,
        harmonics,
        spectrograms,
        models,
        performance,
    })
}

struct Job {
    cancel: Arc<AtomicBool>,
    status: Arc<Mutex<DoctorJobStatus>>,
    worker: std::thread::JoinHandle<()>,
}

#[derive(Default)]
pub(crate) struct DoctorJobs {
    jobs: Mutex<HashMap<String, Job>>,
}

impl DoctorJobs {
    pub(crate) fn start(
        &self,
        id: String,
        processors: Vec<AudioPluginProcessorHandle>,
        settings: DoctorSettings,
        latency: u32,
    ) -> DoctorJobStatus {
        let Ok(mut jobs) = self.jobs.lock() else {
            return failed(DoctorFailure::WorkerUnavailable);
        };
        if let Some(job) = jobs.get(&id) {
            return job
                .status
                .lock()
                .map(|v| v.clone())
                .unwrap_or_else(|_| failed(DoctorFailure::WorkerUnavailable));
        }
        if !settings.valid()
            || latency as f64 >= settings.tail_seconds * f64::from(settings.sample_rate)
        {
            return failed(DoctorFailure::InvalidSettings);
        }
        if !jobs.is_empty() {
            return failed(DoctorFailure::Busy);
        }
        let initial = DoctorJobStatus::Running {
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
            .name("heron-plugin-doctor".to_owned())
            .spawn(move || {
                let result = analyze(chain, latency, &worker_status);
                if let Ok(mut value) = worker_status.lock() {
                    *value = match result {
                        Ok(report) => DoctorJobStatus::Completed {
                            report: Box::new(report),
                        },
                        Err(failure) => failed(failure),
                    };
                }
            });
        let Ok(worker) = worker else {
            return failed(DoctorFailure::WorkerUnavailable);
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

    pub(crate) fn status(&self, id: &str, cancel: bool, release: bool) -> DoctorJobStatus {
        let Ok(mut jobs) = self.jobs.lock() else {
            return failed(DoctorFailure::WorkerUnavailable);
        };
        let Some(job) = jobs.get(id) else {
            return failed(DoctorFailure::MissingJob);
        };
        if cancel {
            job.cancel.store(true, Ordering::Release);
        }
        let value = job
            .status
            .lock()
            .map(|mut s| {
                if matches!(*s, DoctorJobStatus::Running { .. }) && job.worker.is_finished() {
                    *s = failed(DoctorFailure::WorkerUnavailable);
                }
                s.clone()
            })
            .unwrap_or_else(|_| failed(DoctorFailure::WorkerUnavailable));
        if release
            && !matches!(value, DoctorJobStatus::Running { .. })
            && let Some(job) = jobs.remove(id)
        {
            let _ = job.worker.join();
        }
        value
    }
}

impl Drop for DoctorJobs {
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

pub(crate) fn failed(failure: DoctorFailure) -> DoctorJobStatus {
    DoctorJobStatus::Failed { failure }
}
