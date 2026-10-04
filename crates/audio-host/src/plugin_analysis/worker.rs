use super::{
    Arc, AtomicBool, AudioPluginProcessorHandle, Chain, HashMap, Mutex, Ordering,
    PluginAnalysisFailure, PluginAnalysisJobStatus, PluginAnalysisPerformance,
    PluginAnalysisReport, PluginAnalysisSettings, StereoRoute, model, signal, spectrogram,
};

pub(super) fn analyze(
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
        let response_excitation = if settings.linear_excitation == "sweep" {
            excitation.clone()
        } else {
            signal::broadband_excitation(&settings)
        };
        let (response_output, response_repeated) = if settings.linear_excitation == "sweep" {
            (output.clone(), repeated.clone())
        } else {
            chain.settle()?;
            let first = chain.capture_route(&response_excitation, source, tail, false)?;
            chain.settle()?;
            let second = chain.capture_route(&response_excitation, source, tail, false)?;
            (first, second)
        };
        for destination in routes {
            if chain.cancel.load(Ordering::Acquire) {
                return Err(PluginAnalysisFailure::Cancelled);
            }
            let destination_measured: Vec<f64> = response_output
                .iter()
                .map(|frame| destination.measure(*frame))
                .collect();
            let destination_repeated: Vec<f64> = response_repeated
                .iter()
                .map(|frame| destination.measure(*frame))
                .collect();
            let response_fn = if settings.linear_excitation == "sweep" {
                signal::response
            } else {
                signal::broadband_response
            };
            let mut response = response_fn(
                &response_excitation,
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
    update("performance", 0.95);
    let block_sizes = chain.performance_scan()?;
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
        block_sizes,
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
        comparison_processors: Option<Vec<AudioPluginProcessorHandle>>,
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
            comparison_processors,
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

#[cfg(test)]
#[path = "job_tests.rs"]
mod job_tests;
