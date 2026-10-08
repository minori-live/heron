//! Editable response targets are independent of transport/audio publication.
//! IIR targets are immediate; finite FIR matrices are prepared by one editor
//! worker with a latest-only request slot, never in canvas drawing or audio.

use super::model::Extras;
use crate::{output_pan::OutputPan, response::ResponseSnapshot};
use heron_dsp_core::eq::{EqConfig, EqError, EqProcessor, ProcessingMode};
use std::{
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread::{self, JoinHandle},
};

#[derive(Clone, PartialEq)]
struct KernelKey {
    config: EqConfig,
    sample_rate: f64,
}

struct Request {
    generation: u64,
    key: KernelKey,
}

struct Completion {
    generation: u64,
    response: Result<Arc<ResponseSnapshot>, EqError>,
}

#[derive(Default)]
struct Work {
    request: Option<Request>,
    completed: Option<Completion>,
}

#[derive(Default)]
struct Shared {
    work: Mutex<Work>,
    wake: Condvar,
    stop: AtomicBool,
    generation: AtomicU64,
    revision: AtomicU64,
}

pub(super) struct ResponsePreview {
    key: Option<KernelKey>,
    shared: Arc<Shared>,
    worker: Option<JoinHandle<()>>,
}

pub(super) struct Projection {
    pub config: EqConfig,
    pub sample_rate: f64,
    pub pan: [[f64; 2]; 2],
    pub prepared: Option<Arc<ResponseSnapshot>>,
    pub show_total_response: bool,
    pub pending: bool,
    pub failed: bool,
    /// Revision observed together with this snapshot, avoiding a lost redraw
    /// if the worker completes between view construction and needs_redraw().
    pub revision: u64,
}

impl Default for ResponsePreview {
    fn default() -> Self {
        let shared = Arc::new(Shared::default());
        let thread_shared = Arc::clone(&shared);
        let worker = thread::Builder::new()
            .name("heron-eq-preview".into())
            .spawn(move || run_worker(&thread_shared))
            .ok();
        Self {
            key: None,
            shared,
            worker,
        }
    }
}

impl ResponsePreview {
    /// The editor's redraw probe reads this even when no audio samples arrive.
    pub fn revision(&self) -> u64 {
        self.shared.revision.load(Ordering::Acquire)
    }

    /// Project current edit intent, not last accepted/smoothed audio metadata.
    /// Automatic gain retains its last measured compensation until new audio
    /// arrives. Its enable switch, manual trim, pan and bypass are immediate.
    pub fn project(
        &mut self,
        config: &EqConfig,
        extras: Extras,
        sample_rate: f64,
        auto_gain_db: f32,
        solo: bool,
        stereo_output: bool,
    ) -> Projection {
        let sample_rate = if sample_rate.is_finite() && (8000.0..=384000.0).contains(&sample_rate) {
            sample_rate
        } else {
            44100.0
        };
        // Match the native preparation boundary, including gain-scale clipping
        // and the sample-rate limit, before evaluating either IIR or FIR.
        let mut core = config.clone();
        core.output_gain_db = 0.0;
        core.bypass = false;
        for band in &mut core.bands {
            band.frequency_hz = band.frequency_hz.min(sample_rate * 0.498);
            band.gain_db = (band.gain_db * extras.gain_scale).clamp(-36.0, 36.0);
        }
        let valid = core.validate(sample_rate).is_ok() && config.output_gain_db.is_finite();
        let key = KernelKey {
            config: core.clone(),
            sample_rate,
        };
        let linear = core.processing_mode == ProcessingMode::LinearPhase;
        if self.key.as_ref() != Some(&key) {
            let generation = self
                .shared
                .generation
                .load(Ordering::Relaxed)
                .wrapping_add(1)
                .max(1);
            self.shared.generation.store(generation, Ordering::Release);
            let mut work = self
                .shared
                .work
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            work.completed = None;
            work.request = (linear && valid).then(|| Request {
                generation,
                key: key.clone(),
            });
            self.key = Some(key);
            self.shared.wake.notify_one();
        }
        let (prepared, failed, revision) = if linear && valid {
            let work = self
                .shared
                .work
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let result = match work.completed.as_ref().filter(|completed| {
                completed.generation == self.shared.generation.load(Ordering::Acquire)
            }) {
                Some(completed) => match &completed.response {
                    Ok(response) => (Some(Arc::clone(response)), false),
                    Err(_) => (None, true),
                },
                None => (None, self.worker.is_none()),
            };
            (result.0, result.1, self.revision())
        } else {
            (None, !valid, self.revision())
        };
        let show_total_response = config.bypass || valid && !extras.output_mute && !solo;
        let pending =
            linear && show_total_response && !config.bypass && prepared.is_none() && !failed;
        core.output_gain_db = config.output_gain_db
            + if extras.auto_gain && auto_gain_db.is_finite() {
                f64::from(auto_gain_db)
            } else {
                0.0
            };
        core.bypass = config.bypass;
        Projection {
            config: core,
            sample_rate,
            pan: OutputPan::new(
                sample_rate,
                extras.output_pan,
                extras.output_pan_mode,
                stereo_output,
            )
            .matrix(),
            prepared,
            show_total_response,
            pending,
            failed,
            revision,
        }
    }
}

fn run_worker(shared: &Shared) {
    loop {
        let request = {
            let mut work = shared
                .work
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            while work.request.is_none() && !shared.stop.load(Ordering::Acquire) {
                work = shared
                    .wake
                    .wait(work)
                    .unwrap_or_else(|error| error.into_inner());
            }
            if shared.stop.load(Ordering::Acquire) {
                return;
            }
            work.request.take()
        };
        let Some(request) = request else {
            continue;
        };
        let current = || {
            !shared.stop.load(Ordering::Acquire)
                && request.generation == shared.generation.load(Ordering::Acquire)
        };
        if !current() {
            continue;
        }
        let response = match EqProcessor::prepare(&request.key.config, request.key.sample_rate) {
            Ok(processor) => {
                let Some(response) = crate::response::prepare_response_cancellable(
                    &processor,
                    request.key.sample_rate,
                    request.generation,
                    current,
                ) else {
                    continue;
                };
                Ok(Arc::new(response))
            }
            Err(error) => Err(error),
        };
        let mut work = shared
            .work
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if current() {
            work.completed = Some(Completion {
                generation: request.generation,
                response,
            });
            shared.revision.fetch_add(1, Ordering::Release);
        }
    }
}

impl Drop for ResponsePreview {
    fn drop(&mut self) {
        // Joining is required before the host can unload the plugin DLL. Close
        // may wait for one in-flight kernel design; the frequency grid cancels
        // between points. Never hold the publication lock while joining.
        {
            let _work = self
                .shared
                .work
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            self.shared.stop.store(true, Ordering::Release);
            self.shared.wake.notify_one();
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
#[path = "response_preview_tests.rs"]
mod tests;
