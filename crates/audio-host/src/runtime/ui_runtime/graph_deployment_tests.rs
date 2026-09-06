#![allow(clippy::wildcard_imports)]

use super::*;
use crate::runtime::{
    BounceJobRegistry, GraphParameterHandles, Vst3ActorDeps, audio_plugin_actor, dispatch_actor,
    engine_actor,
};
use heron_dsp_runtime::protocol::{
    GraphDeploymentStatus, GraphOperationOutcome, GraphTransactionRequest, GraphTransactionValue,
    IPC_PROTOCOL_VERSION, PrepareGraphRequest, ResourceKind, ResourceRef, RpcMutationMeta,
    RpcRequestMeta, RpcResult,
};

pub(super) fn empty_graph() -> LiveMixerGraph {
    LiveMixerGraph {
        sample_rate: 48_000,
        project_end_tick: 61_440,
        latency_policy: Default::default(),
        channels: ["master", "output"]
            .into_iter()
            .map(|kind| heron_dsp_runtime::protocol::LiveMixerChannel {
                id: kind.into(),
                name: kind.into(),
                color: String::new(),
                kind: kind.into(),
                system_role: None,
                gain_db: 0.0,
                pan: 0.0,
                muted: false,
                soloed: false,
                output_channel_id: None,
                output_bus: None,
                record_armed: false,
                input_monitoring: false,
                midi_input_port_id: None,
                midi_input_port_name: None,
                midi_input_channel: None,
                input_source: None,
                input_channels: vec![],
                application_capture: None,
                hardware_output_channels: if kind == "output" { vec![1, 2] } else { vec![] },
            })
            .collect(),
        sends: vec![],
        clips: vec![],
        plugins: vec![],
        midi_clips: vec![],
        tempo_events: vec![heron_dsp_runtime::protocol::LiveTempoEvent {
            tick: 0,
            beats_per_minute: 120.0,
        }],
        time_signature_events: vec![heron_dsp_runtime::protocol::LiveTimeSignatureEvent {
            tick: 0,
            numerator: 4,
            denominator: 4,
        }],
    }
}

fn meta() -> RpcRequestMeta {
    RpcRequestMeta {
        protocol_version: IPC_PROTOCOL_VERSION,
        request_id: "activate".into(),
        target: Some(ResourceRef {
            kind: ResourceKind::AudioEngine,
            id: "engine".into(),
            epoch: "42".into(),
            generation: 1,
        }),
        expected_revision: Some(0),
        mutation: Some(RpcMutationMeta {
            operation_id: "activation".into(),
            idempotency_key: "activation".into(),
        }),
    }
}

fn project() -> ResourceRef {
    ResourceRef {
        kind: ResourceKind::ProjectGraph,
        id: "project".into(),
        epoch: "project-epoch".into(),
        generation: 1,
    }
}

#[test]
fn graph_activation_rollback_and_competing_refreshes_preserve_the_commit_boundary() {
    let _guard = engine::GRAPH_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let local = tokio::task::LocalSet::new();
    runtime.block_on(local.run_until(async {
            let audio_engine = Arc::new(engine::AudioEngine::new());
            let graph_build_gate = Arc::new(tokio::sync::Mutex::new(()));
            let processors = Arc::new(Mutex::new(HashMap::new()));
            let (ui_sender, ui_receiver) = std_mpsc::sync_channel::<ActorRequest>(8);
            let ui_engine = Arc::clone(&audio_engine);
            let ui_processors = Arc::clone(&processors);
            let ui = std::thread::spawn(move || {
                let (mut host, _events) = test_support::host(8);
                host.audio_engine = ui_engine;
                host.processors = ui_processors;
                host.vst3 = Some(vst3::Vst3Runtime::new());
                let mut fail_ara = true;
                while let Ok(request) = ui_receiver.recv() {
                    if matches!(&request.command, ActorCommand::SyncAraGraph { graph: Some(_) }) && fail_ara {
                        fail_ara = false;
                        let _ = request.reply.send(control_error! { message: "injected ARA failure".into() });
                    } else {
                        host.execute_audio_plugin_request(request);
                    }
                }
            });
            let handles = Arc::new(Mutex::new(GraphParameterHandles::default()));
            let (engine_sender, engine_receiver) = mpsc::channel(8);
            let engine_task = tokio::spawn(engine_actor(engine_receiver, Arc::clone(&handles), Arc::clone(&audio_engine)));
            let (background_sender, background_receiver) = mpsc::channel(8);
            let background_task = tokio::spawn(crate::runtime::background_io_actor(
                background_receiver, engine_sender.clone(), Arc::clone(&audio_engine), Arc::clone(&graph_build_gate)
            ));
            let (sender, receiver) = mpsc::channel(8);
            let actor = tokio::task::spawn_local(audio_plugin_actor(receiver, Vst3ActorDeps {
                ui_proxy: UiMailboxWaker::new(Arc::new(|| {})), ui_sender, processors, handles,
                engine_sender, audio_engine: Arc::clone(&audio_engine), graph_build_gate, session_epoch: 42,
                bounce_jobs: Arc::new(BounceJobRegistry::default()),
            }));
            let prepare = ControlCommand::PrepareGraph {
                meta: meta(), request: Box::new(PrepareGraphRequest {
                    helper_epoch: "42".into(), project_graph: project(), base_revision: 0,
                    graph_revision: 1, graph: empty_graph(),
                }),
            };
            assert!(matches!(dispatch_actor(&sender, prepare.clone()).await, ControlResult::GraphTransaction { result } if matches!(*result, RpcResult::Success(_))));
            let failed = dispatch_actor(&sender, ControlCommand::ActivateGraph {
                meta: meta(), request: GraphTransactionRequest { helper_epoch: "42".into(), project_graph: project(), base_revision: 0 },
            }).await;
            assert!(matches!(failed, ControlResult::GraphTransaction { result } if matches!(*result, RpcResult::Failure(_))));
            let snapshot = dispatch_actor(&sender, ControlCommand::GraphDeploymentSnapshot { meta: meta() }).await;
            let ControlResult::GraphTransaction { result } = snapshot else { panic!("transaction response") };
            let RpcResult::Success(result) = *result else { panic!("snapshot success") };
            let GraphTransactionValue::Snapshot { snapshot } = result.value else { panic!("snapshot value") };
            assert_eq!(snapshot.status, GraphDeploymentStatus::Empty);
            assert!(snapshot.candidate.is_none());
            assert_eq!(snapshot.last_operation.unwrap().outcome, GraphOperationOutcome::NotCommitted);
            assert!(matches!(dispatch_actor(&sender, prepare).await, ControlResult::GraphTransaction { result } if matches!(*result, RpcResult::Success(_))));

            // Internal refreshes wait without monopolizing background control dispatch.
            let prepared_generation = audio_engine.latest_build_generation_for_test();
            let mut refresh_replies = Vec::new();
            for _ in 0..2 {
                let (reply, response) = tokio::sync::oneshot::channel();
                let graph = crate::runtime::live_graph(0, &empty_graph(), None).unwrap();
                background_sender.send(ActorRequest { command: ActorCommand::BuildGraph { graph }, reply }).await.unwrap();
                refresh_replies.push(response);
            }
            let background_snapshot = tokio::time::timeout(Duration::from_secs(1), dispatch_actor(&background_sender, ControlCommand::DeviceRecoverySnapshot)).await.unwrap();
            assert!(matches!(background_snapshot, ControlResult::AudioDeviceRecovery { .. }));
            assert_eq!(audio_engine.latest_build_generation_for_test(), prepared_generation);
            assert!(matches!(refresh_replies.remove(0).await.unwrap(), ControlResult::Busy));

            let activated = dispatch_actor(&sender, ControlCommand::ActivateGraph {
                meta: meta(), request: GraphTransactionRequest { helper_epoch: "42".into(), project_graph: project(), base_revision: 0 },
            }).await;
            assert!(matches!(activated, ControlResult::GraphTransaction { result } if matches!(*result, RpcResult::Success(_))));
            assert!(matches!(refresh_replies.remove(0).await.unwrap(), ControlResult::Accepted));
            assert_eq!(audio_engine.published_graph_generation(), 0);
            assert_eq!(audio_engine.last_native_graph_generation_for_test(), Some(1));

            let mut next_meta = meta();
            next_meta.expected_revision = Some(1);
            next_meta.mutation.as_mut().unwrap().operation_id = "next-graph".into();
            let next_request = GraphTransactionRequest { helper_epoch: "42".into(), project_graph: project(), base_revision: 1 };
            let next_prepare = ControlCommand::PrepareGraph {
                meta: next_meta.clone(), request: Box::new(PrepareGraphRequest {
                    helper_epoch: "42".into(), project_graph: project(), base_revision: 1,
                    graph_revision: 2, graph: empty_graph(),
                }),
            };
            assert!(matches!(dispatch_actor(&sender, next_prepare.clone()).await, ControlResult::GraphTransaction { result } if matches!(*result, RpcResult::Success(_))));
            // Replaying preparation does not create another candidate or acquire its gate again.
            assert!(matches!(dispatch_actor(&sender, next_prepare).await, ControlResult::GraphTransaction { result } if matches!(*result, RpcResult::Success(_))));
            let abort = ControlCommand::AbortGraph { meta: next_meta, request: next_request };
            for expected_existed in [true, false] {
                let aborted = dispatch_actor(&sender, abort.clone()).await;
                let ControlResult::GraphTransaction { result } = aborted else { panic!("transaction response") };
                let RpcResult::Success(result) = *result else { panic!("abort success") };
                let GraphTransactionValue::Aborted { existed, snapshot, .. } = result.value else { panic!("abort value") };
                assert_eq!(existed, expected_existed);
                assert!(snapshot.candidate.is_none());
                assert_eq!(snapshot.committed_revision, 1);
            }
            assert_eq!(audio_engine.last_native_graph_generation_for_test(), Some(1));
            drop(sender);
            drop(background_sender);
            actor.await.unwrap();
            background_task.await.unwrap();
            engine_task.await.unwrap();
            ui.join().unwrap();
        }));
}
