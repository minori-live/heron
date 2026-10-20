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

#[cfg(test)]
mod tests {
    use super::*;
    use heron_dsp_runtime::protocol::{LiveLatencyPolicy, LiveMixerChannel, LiveMixerGraph};
    use heron_dsp_runtime::tempo::{TempoEvent, TimeSignatureEvent};
    use std::time::Duration;

    fn channel(id: &str, kind: &str) -> LiveMixerChannel {
        LiveMixerChannel {
            id: id.to_owned(),
            name: id.to_owned(),
            color: "#000000".to_owned(),
            kind: kind.to_owned(),
            system_role: None,
            gain_db: 0.0,
            pan: 0.0,
            muted: false,
            soloed: false,
            output_channel_id: (kind == "audio").then(|| "output".to_owned()),
            output_bus: None,
            output_format: None,
            record_armed: false,
            input_monitoring: false,
            midi_input_port_id: None,
            midi_input_port_name: None,
            midi_input_channel: None,
            input_source: None,
            input_channels: Vec::new(),
            application_capture: None,
            hardware_output_channels: if kind == "output" {
                vec![1, 2]
            } else {
                Vec::new()
            },
        }
    }

    fn request(operation_id: &str, end_frame: u64) -> TrackFreezeRenderRequest {
        let path = std::env::temp_dir().join(format!(
            "heron-freeze-job-{operation_id}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        TrackFreezeRenderRequest {
            operation_id: operation_id.to_owned(),
            graph_revision: 1,
            graph: LiveMixerGraph {
                sample_rate: 48_000,
                project_end_tick: 3_840,
                latency_policy: LiveLatencyPolicy::Normal,
                channels: vec![
                    channel("audio", "audio"),
                    channel("master", "master"),
                    channel("output", "output"),
                ],
                sends: Vec::new(),
                clips: Vec::new(),
                plugins: Vec::new(),
                midi_clips: Vec::new(),
                tempo_events: vec![TempoEvent {
                    tick: 0,
                    beats_per_minute: 120.0,
                }],
                time_signature_events: vec![TimeSignatureEvent {
                    tick: 0,
                    numerator: 4,
                    denominator: 4,
                }],
            },
            channel_id: "audio".to_owned(),
            mode: heron_dsp_runtime::protocol::TrackFreezeMode::PreFader,
            start_frame: 0,
            end_frame,
            output_path: path.to_string_lossy().into_owned(),
        }
    }

    fn wait_for_terminal(
        registry: &TrackFreezeJobRegistry,
        operation_id: &str,
    ) -> TrackFreezeJobStatus {
        for _ in 0..2_000 {
            let status = registry
                .status(operation_id)
                .expect("read freeze job status");
            if status.state != BounceJobState::Running {
                return status;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        panic!("track freeze job did not reach a terminal state");
    }

    #[test]
    fn registry_completes_a_job_and_reconciles_a_duplicate_start() {
        let registry = TrackFreezeJobRegistry::default();
        let request = request("complete", 128);
        let output_path = PathBuf::from(&request.output_path);
        let initial = registry
            .start(request.clone(), HashMap::new())
            .expect("start freeze job");
        assert_eq!(initial.state, BounceJobState::Running);
        let duplicate = registry
            .start(request, HashMap::new())
            .expect("reconcile duplicate freeze job");
        assert_eq!(duplicate.operation_id, "complete");
        let completed = wait_for_terminal(&registry, "complete");
        assert_eq!(completed.state, BounceJobState::Completed);
        assert_eq!(completed.rendered_frames, Some(128));
        assert!(output_path.is_file());
        std::fs::remove_file(output_path).expect("remove freeze job output");
        assert!(registry.status("missing").is_err());
        assert!(registry.cancel("missing").is_err());
    }

    #[test]
    fn registry_reports_failed_and_cancelled_jobs_and_rejects_parallel_work() {
        let registry = TrackFreezeJobRegistry::default();
        let failed_request = request("failed", 0);
        let failed_path = PathBuf::from(&failed_request.output_path);
        registry
            .start(failed_request, HashMap::new())
            .expect("start invalid freeze job");
        let failed = wait_for_terminal(&registry, "failed");
        assert_eq!(failed.state, BounceJobState::Failed);
        assert!(
            failed
                .error
                .as_deref()
                .is_some_and(|error| error.contains("invalid"))
        );
        assert!(!failed_path.exists());

        let long_request = request("long", 48_000_000);
        let long_path = PathBuf::from(&long_request.output_path);
        registry
            .start(long_request.clone(), HashMap::new())
            .expect("start cancellable freeze job");
        assert_eq!(
            registry
                .start(request("parallel", 64), HashMap::new())
                .expect_err("reject parallel freeze job"),
            "another track freeze is active"
        );
        registry.cancel("long").expect("cancel freeze job");
        let cancelled = wait_for_terminal(&registry, "long");
        assert_eq!(cancelled.state, BounceJobState::Cancelled);
        assert!(cancelled.error.is_none());
        assert!(!long_path.exists());
    }

    use super::super::{
        ActorRequest, BounceJobRegistry, ControlCommand, ControlResult, GraphParameterHandles,
        UiMailboxWaker, Vst3ActorDeps, audio_plugin_actor, dispatch_actor, engine, is_vst3_command,
        mpsc, std_mpsc,
    };

    async fn actor_status(
        sender: &mpsc::Sender<ActorRequest>,
        operation_id: &str,
    ) -> TrackFreezeJobStatus {
        for _ in 0..2_000 {
            let result = dispatch_actor(
                sender,
                ControlCommand::TrackFreezeStatus {
                    operation_id: operation_id.to_owned(),
                },
            )
            .await;
            let ControlResult::TrackFreeze { status } = result else {
                panic!("expected freeze status");
            };
            if status.state != BounceJobState::Running {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        panic!("track freeze actor job did not reach a terminal state");
    }

    #[test]
    fn actor_dispatches_start_status_and_cancel() {
        let policy = request("policy", 1);
        assert!(is_vst3_command(&ControlCommand::StartTrackFreeze {
            request: Box::new(policy),
        }));
        assert!(is_vst3_command(&ControlCommand::TrackFreezeStatus {
            operation_id: "policy".into(),
        }));
        assert!(is_vst3_command(&ControlCommand::CancelTrackFreeze {
            operation_id: "policy".into(),
        }));

        let _guard = engine::GRAPH_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        let local = tokio::task::LocalSet::new();
        runtime.block_on(local.run_until(async {
            let (ui_sender, _ui_receiver) = std_mpsc::sync_channel(8);
            let (engine_sender, _engine_receiver) = mpsc::channel(8);
            let (sender, receiver) = mpsc::channel(8);
            let actor = tokio::task::spawn_local(audio_plugin_actor(
                receiver,
                Vst3ActorDeps {
                    ui_proxy: UiMailboxWaker::new(Arc::new(|| {})),
                    ui_sender,
                    processors: Arc::new(Mutex::new(HashMap::new())),
                    handles: Arc::new(Mutex::new(GraphParameterHandles::default())),
                    engine_sender,
                    audio_engine: Arc::new(engine::AudioEngine::new()),
                    graph_build_gate: Arc::new(tokio::sync::Mutex::new(())),
                    session_epoch: 1,
                    bounce_jobs: Arc::new(BounceJobRegistry::default()),
                    freeze_jobs: Arc::new(TrackFreezeJobRegistry::default()),
                    plugin_analysis_jobs: Arc::new(
                        crate::plugin_analysis::PluginAnalysisJobs::default(),
                    ),
                },
            ));

            assert!(matches!(
                dispatch_actor(
                    &sender,
                    ControlCommand::TrackFreezeStatus {
                        operation_id: "missing".into(),
                    },
                )
                .await,
                ControlResult::Error { .. }
            ));
            assert!(matches!(
                dispatch_actor(
                    &sender,
                    ControlCommand::CancelTrackFreeze {
                        operation_id: "missing".into(),
                    },
                )
                .await,
                ControlResult::Error { .. }
            ));

            let mut failed = request("actor-failed", 0);
            failed.mode = heron_dsp_runtime::protocol::TrackFreezeMode::SourceOnly;
            let started = dispatch_actor(
                &sender,
                ControlCommand::StartTrackFreeze {
                    request: Box::new(failed),
                },
            )
            .await;
            let ControlResult::TrackFreeze { status } = started else {
                panic!("expected a running freeze job");
            };
            assert_eq!(status.state, BounceJobState::Running);
            assert_eq!(
                actor_status(&sender, "actor-failed").await.state,
                BounceJobState::Failed
            );

            let long_request = request("actor-long", 48_000_000);
            let long_path = PathBuf::from(&long_request.output_path);
            assert!(matches!(
                dispatch_actor(
                    &sender,
                    ControlCommand::StartTrackFreeze {
                        request: Box::new(long_request),
                    },
                )
                .await,
                ControlResult::TrackFreeze { .. }
            ));
            assert!(matches!(
                dispatch_actor(
                    &sender,
                    ControlCommand::TrackFreezeStatus {
                        operation_id: "actor-long".into(),
                    },
                )
                .await,
                ControlResult::TrackFreeze { .. }
            ));
            assert!(matches!(
                dispatch_actor(
                    &sender,
                    ControlCommand::StartTrackFreeze {
                        request: Box::new(request("actor-parallel", 64)),
                    },
                )
                .await,
                ControlResult::Error { .. }
            ));
            assert!(matches!(
                dispatch_actor(
                    &sender,
                    ControlCommand::CancelTrackFreeze {
                        operation_id: "actor-long".into(),
                    },
                )
                .await,
                ControlResult::TrackFreeze { .. }
            ));
            assert_eq!(
                actor_status(&sender, "actor-long").await.state,
                BounceJobState::Cancelled
            );
            assert!(!long_path.exists());
            drop(sender);
            actor.await.expect("freeze actor stopped");
        }));
    }
}
