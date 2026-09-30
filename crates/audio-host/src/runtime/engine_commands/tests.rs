use super::*;
use heron_dsp_runtime::protocol::{
    AudioEngineConfig, LiveLatencyPolicy, LiveMixerChannel, LiveMixerGraph, MixerParameterPreview,
    RpcErrorCode, RpcMutationOutcome, RpcRetry, TransportControl,
};
use heron_dsp_runtime::tempo::{TempoEvent, TimeSignatureEvent};

fn mock_config() -> AudioEngineConfig {
    AudioEngineConfig {
        backend: "mock".to_owned(),
        input_device_id: "custom:mock-duplex".to_owned(),
        output_device_id: "custom:mock-duplex".to_owned(),
        buffer_size: 128,
        session_sample_rate: Some(44_100),
    }
}

fn assert_host_error(result: Option<ControlResult>) {
    let Some(ControlResult::Error { error }) = result else {
        panic!("expected a structured host failure");
    };
    assert_eq!(error.code, RpcErrorCode::InvariantViolation);
    assert_eq!(error.outcome, RpcMutationOutcome::Quarantined);
    assert_eq!(error.retry, RpcRetry::AfterReconcile);
    assert!(!error.correlation_id.is_empty());
}

#[test]
fn discovery_dispatch_preserves_device_capabilities_and_rejects_unknown_backends() {
    let engine = engine::AudioEngine::new();
    let Some(ControlResult::AudioBackends { backends }) =
        engine_command(&engine, ControlCommand::ListAudioBackends)
    else {
        panic!("expected backend discovery");
    };
    assert!(
        backends
            .iter()
            .any(|backend| backend.id == "mock" && backend.available)
    );
    let Some(ControlResult::AudioDevices { devices }) = engine_command(
        &engine,
        ControlCommand::ListAudioDevices {
            backend: "mock".to_owned(),
        },
    ) else {
        panic!("expected mock devices");
    };
    let duplex = devices
        .inputs
        .iter()
        .find(|device| device.id == "custom:mock-duplex")
        .unwrap();
    assert_eq!(duplex.channel_count, Some(2));
    assert_eq!(duplex.default_sample_rate, Some(48_000));
    assert!(devices.outputs.iter().any(|device| device.id == duplex.id));
    assert_host_error(engine_command(
        &engine,
        ControlCommand::ListAudioDevices {
            backend: "unsupported-backend".to_owned(),
        },
    ));
    // The engine dispatcher must leave unrelated commands for their owning actor.
    assert!(engine_command(&engine, ControlCommand::Ping).is_none());
}

#[test]
fn stopped_engine_dispatch_reports_state_and_rejects_transport_and_recording_mutations() {
    let engine = engine::AudioEngine::new();
    for command in [
        ControlCommand::Transport {
            command: TransportControl {
                kind: "play".to_owned(),
                position_frames: Some(42),
                loop_enabled: None,
                loop_start_tick: None,
                loop_end_tick: None,
            },
        },
        ControlCommand::StartRecording {
            config: RecordingStartConfig {
                path: "not-created.bwf".to_owned(),
                asset_id: "take".to_owned(),
                originator: "Heron tests".to_owned(),
                origination_date: "2026-09-30".to_owned(),
                origination_time: "00:00:00".to_owned(),
                time_reference: 0,
                sample_rate: 44_100,
                channels: 2,
            },
        },
        ControlCommand::StopRecording,
        ControlCommand::RecordingWaveform {
            start_frame: 0,
            end_frame: 64,
            max_buckets: 1,
        },
    ] {
        assert_host_error(engine_command(&engine, command));
    }
    let Some(ControlResult::TransportSnapshot { transport }) =
        engine_command(&engine, ControlCommand::TransportSnapshot)
    else {
        panic!("expected stopped transport snapshot");
    };
    assert_eq!(transport.state, "stopped");
    assert_eq!(transport.sample_rate, 0);
    let mut invalid = mock_config();
    invalid.buffer_size = 0;
    assert_host_error(engine_command(
        &engine,
        ControlCommand::StartAudioEngine { config: invalid },
    ));
}

#[test]
fn running_dispatch_preserves_session_clock_loop_fields_and_channel_meter_identity() {
    let _guard = engine::GRAPH_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let engine = engine::AudioEngine::new();
    // The master and its hardware output exercise distinct meter identities.
    let mut graph = LiveMixerGraph {
        sample_rate: 44_100,
        project_end_tick: 7_680,
        latency_policy: LiveLatencyPolicy::Normal,
        channels: vec![LiveMixerChannel {
            id: "output".to_owned(),
            name: "Output".to_owned(),
            color: String::new(),
            kind: "output".to_owned(),
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
            hardware_output_channels: vec![1, 2],
        }],
        sends: vec![],
        clips: vec![],
        plugins: vec![],
        midi_clips: vec![],
        tempo_events: vec![TempoEvent {
            tick: 0,
            beats_per_minute: 120.0,
        }],
        time_signature_events: vec![TimeSignatureEvent {
            tick: 0,
            numerator: 4,
            denominator: 4,
        }],
    };
    graph.channels.push(LiveMixerChannel {
        id: "master".to_owned(),
        name: "Master".to_owned(),
        kind: "master".to_owned(),
        hardware_output_channels: vec![],
        ..graph.channels[0].clone()
    });
    engine.load_mixer_graph(&graph, 1).unwrap();
    let Some(ControlResult::AudioRuntime { runtime }) = engine_command(
        &engine,
        ControlCommand::StartAudioEngine {
            config: mock_config(),
        },
    ) else {
        panic!("expected running runtime");
    };
    assert_eq!(runtime.state, "running");
    assert_eq!(runtime.sample_rate, Some(44_100));
    assert_eq!(runtime.input_sample_rate, Some(48_000));
    assert_eq!(runtime.requested_buffer_size, Some(128));

    let Some(ControlResult::TransportSnapshot { transport }) = engine_command(
        &engine,
        ControlCommand::Transport {
            command: TransportControl {
                kind: "set-loop".to_owned(),
                position_frames: None,
                loop_enabled: Some(true),
                loop_start_tick: Some(960),
                loop_end_tick: Some(3_840),
            },
        },
    ) else {
        panic!("expected loop transport");
    };
    assert_eq!(transport.sample_rate, 44_100);
    assert!(transport.loop_enabled);
    assert_eq!(transport.loop_start_tick, Some(960));
    assert_eq!(transport.loop_end_tick, Some(3_840));
    let Some(ControlResult::TransportSnapshot {
        transport: snapshot,
    }) = engine_command(&engine, ControlCommand::TransportSnapshot)
    else {
        panic!("expected transport snapshot");
    };
    assert_eq!(snapshot, transport);

    let preview = MixerParameterPreview {
        target: "channel".to_owned(),
        id: "output".to_owned(),
        parameter: "gainDb".to_owned(),
        value: -6.0,
    };
    assert!(matches!(
        engine_command(&engine, ControlCommand::PreviewMixerParameter { preview }),
        Some(ControlResult::Accepted)
    ));
    let Some(ControlResult::MixerSnapshot { meters }) =
        engine_command(&engine, ControlCommand::MixerSnapshot)
    else {
        panic!("expected channel meters");
    };
    assert_eq!(meters.len(), 2);
    assert_eq!(meters[1].channel_id, "master");
    assert_eq!(meters[0].channel_id, "output");
    assert_eq!(
        [
            meters[0].pre_left,
            meters[0].pre_right,
            meters[0].post_left,
            meters[0].post_right
        ],
        [0.0; 4]
    );
    assert!(!meters[0].clipped);
    assert!(matches!(
        engine_command(&engine, ControlCommand::ClearMeterClips),
        Some(ControlResult::Accepted)
    ));
    let Some(ControlResult::AudioRuntime { runtime }) =
        engine_command(&engine, ControlCommand::AudioEngineSnapshot)
    else {
        panic!("expected running snapshot");
    };
    assert_eq!(runtime.sample_rate, Some(44_100));
    let Some(ControlResult::AudioRuntime { runtime }) =
        engine_command(&engine, ControlCommand::StopAudioEngine)
    else {
        panic!("expected stopped runtime");
    };
    assert_eq!(runtime.state, "stopped");
    assert_eq!(runtime.sample_rate, None);
}

#[test]
fn audition_commands_map_acceptance_and_engine_errors_to_wire_results() {
    assert!(matches!(
        audition_control_result(Ok::<(), &str>(())),
        ControlResult::Accepted
    ));
    assert!(matches!(
        audition_control_result(Err::<(), _>("audition failed")),
        ControlResult::Error { .. }
    ));

    let engine = engine::AudioEngine::new();
    assert!(matches!(
        engine_command(
            &engine,
            ControlCommand::StartAssetAudition {
                path: "missing.bwf".to_owned(),
                hardware_outputs: [1, 2]
            },
        ),
        Some(ControlResult::Error { .. })
    ));
    assert!(matches!(
        engine_command(&engine, ControlCommand::StopAssetAudition),
        Some(ControlResult::Error { .. })
    ));
}

#[test]
fn recovery_commands_return_typed_results_for_empty_and_stale_decisions() {
    let engine = engine::AudioEngine::new();
    let config = engine::AudioEngineConfig {
        backend: "mock".to_owned(),
        input_device_id: "custom:mock-duplex".to_owned(),
        output_device_id: "custom:mock-duplex".to_owned(),
        buffer_size: 128,
        session_sample_rate: Some(48_000),
    };

    assert!(matches!(
        engine_command(&engine, ControlCommand::DeviceRecoverySnapshot),
        Some(ControlResult::AudioDeviceRecovery {
            recovery: None,
            runtime: Some(_)
        })
    ));
    assert!(matches!(
        engine_command(
            &engine,
            ControlCommand::AuthorizeDeviceRecovery { recovery_id: 99 },
        ),
        Some(ControlResult::Error { .. })
    ));
    assert!(matches!(
        engine_command(
            &engine,
            ControlCommand::SelectDeviceRecovery {
                recovery_id: 99,
                config
            },
        ),
        Some(ControlResult::Error { .. })
    ));
    assert!(matches!(
        engine_command(
            &engine,
            ControlCommand::KeepRestoredDevice { recovery_id: 99 },
        ),
        Some(ControlResult::Error { .. })
    ));
}
