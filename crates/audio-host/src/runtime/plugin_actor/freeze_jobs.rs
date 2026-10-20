use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use heron_audio_engine::{TrackFreezeProgress, TrackFreezeRequest, render_track_freeze};
use heron_audio_plugin::AudioPluginProcessorHandle;
use heron_dsp_runtime::protocol::{
    BounceJobState, TrackFreezeJobPhase, TrackFreezeJobStatus, TrackFreezeRenderRequest,
};

struct FreezeJob {
    cancel: Arc<AtomicBool>,
    status: Arc<Mutex<TrackFreezeJobStatus>>,
}

#[derive(Default)]
pub(in crate::runtime) struct TrackFreezeJobRegistry {
    jobs: Mutex<HashMap<String, FreezeJob>>,
}

impl TrackFreezeJobRegistry {
    pub(super) fn start(
        &self,
        request: TrackFreezeRenderRequest,
        plugin_slots: HashMap<String, AudioPluginProcessorHandle>,
    ) -> Result<TrackFreezeJobStatus, String> {
        let operation_id = request.operation_id.clone();
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "track freeze job registry is poisoned".to_owned())?;
        if let Some(job) = jobs.get(&operation_id) {
            return job
                .status
                .lock()
                .map(|status| status.clone())
                .map_err(|_| "track freeze job status is poisoned".to_owned());
        }
        jobs.retain(|_, job| {
            job.status
                .lock()
                .map(|status| status.state == BounceJobState::Running)
                .unwrap_or(true)
        });
        if jobs.values().any(|job| {
            job.status
                .lock()
                .map(|status| status.state == BounceJobState::Running)
                .unwrap_or(true)
        }) {
            return Err("another track freeze is active".to_owned());
        }
        let status = TrackFreezeJobStatus {
            operation_id: operation_id.clone(),
            state: BounceJobState::Running,
            phase: TrackFreezeJobPhase::Preparing,
            completed_units: 0,
            total_units: 0,
            rendered_frames: None,
            tail_frames: None,
            latency_samples: None,
            tail_truncated: false,
            error: None,
        };
        let shared_status = Arc::new(Mutex::new(status.clone()));
        let cancel = Arc::new(AtomicBool::new(false));
        jobs.insert(
            operation_id.clone(),
            FreezeJob {
                cancel: Arc::clone(&cancel),
                status: Arc::clone(&shared_status),
            },
        );
        drop(jobs);
        let output_path = PathBuf::from(&request.output_path);
        let cleanup_path = output_path.clone();
        let worker_operation_id = operation_id.clone();
        let spawn_result = thread::Builder::new()
            .name(format!("heron-freeze-{operation_id}"))
            .spawn(move || {
                let native = TrackFreezeRequest {
                    graph: request.graph,
                    revision: request.graph_revision,
                    plugin_slots,
                    channel_id: request.channel_id,
                    mode: request.mode,
                    start_frame: request.start_frame,
                    end_frame: request.end_frame,
                    output_path,
                };
                let result = render_track_freeze(native, &cancel, |progress| {
                    if let Ok(mut status) = shared_status.lock() {
                        match progress {
                            TrackFreezeProgress::Preparing => {
                                status.phase = TrackFreezeJobPhase::Preparing;
                            }
                            TrackFreezeProgress::Rendering {
                                completed_frames,
                                total_frames,
                            } => {
                                status.phase = TrackFreezeJobPhase::Rendering;
                                status.completed_units = completed_frames;
                                status.total_units = total_frames;
                            }
                        }
                    }
                });
                if let Ok(mut status) = shared_status.lock() {
                    match result {
                        Ok(result) => {
                            status.state = BounceJobState::Completed;
                            status.rendered_frames = Some(result.rendered_frames);
                            status.tail_frames = Some(result.tail_frames);
                            status.latency_samples = Some(result.latency_samples);
                            status.tail_truncated = result.tail_truncated;
                        }
                        Err(error) => {
                            let cancelled = cancel.load(Ordering::Relaxed);
                            status.state = if cancelled {
                                BounceJobState::Cancelled
                            } else {
                                BounceJobState::Failed
                            };
                            status.error = (!cancelled).then(|| error.to_string());
                            let _ = std::fs::remove_file(cleanup_path);
                        }
                    }
                }
            });
        if let Err(error) = spawn_result {
            if let Ok(mut jobs) = self.jobs.lock() {
                jobs.remove(&worker_operation_id);
            }
            return Err(format!("could not start track freeze worker: {error}"));
        }
        Ok(status)
    }

    pub(super) fn status(&self, operation_id: &str) -> Result<TrackFreezeJobStatus, String> {
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| "track freeze job registry is poisoned".to_owned())?;
        let job = jobs
            .get(operation_id)
            .ok_or_else(|| "track freeze operation was not found".to_owned())?;
        job.status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "track freeze job status is poisoned".to_owned())
    }

    pub(super) fn cancel(&self, operation_id: &str) -> Result<TrackFreezeJobStatus, String> {
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| "track freeze job registry is poisoned".to_owned())?;
        let job = jobs
            .get(operation_id)
            .ok_or_else(|| "track freeze operation was not found".to_owned())?;
        job.cancel.store(true, Ordering::Release);
        job.status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "track freeze job status is poisoned".to_owned())
    }
}
