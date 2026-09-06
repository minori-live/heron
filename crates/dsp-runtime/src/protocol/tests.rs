use serde::{Deserialize, Serialize};

use super::plugin_failure_fixture::{PluginFailureFixture, PluginFailureFixtureContext};
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagePackFixture {
    name: String,
    producer: String,
    wire_type: String,
    base64: String,
    normalized: serde_json::Value,
}

fn decode_base64(value: &str) -> Vec<u8> {
    let mut decoded = Vec::with_capacity(value.len() / 4 * 3);
    let mut block = [0_u8; 4];
    let mut block_len = 0;
    for byte in value.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        block[block_len] = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => 64,
            _ => panic!("fixture contains invalid base64"),
        };
        block_len += 1;
        if block_len == 4 {
            decoded.push((block[0] << 2) | (block[1] >> 4));
            if block[2] != 64 {
                decoded.push((block[1] << 4) | (block[2] >> 2));
            }
            if block[3] != 64 {
                decoded.push((block[2] << 6) | block[3]);
            }
            block_len = 0;
        }
    }
    assert_eq!(block_len, 0, "fixture base64 must contain complete blocks");
    decoded
}

#[test]
fn legacy_windows_application_capture_target_defaults_bundle_identifier() {
    let target: ApplicationCaptureTarget = serde_json::from_value(serde_json::json!({
        "platform": "windows",
        "executable_path": "C:\\Program Files\\Player\\player.exe",
        "executable_name": "player.exe",
        "include_process_tree": true
    }))
    .expect("legacy Windows target must remain readable");

    assert_eq!(target.platform, "windows");
    assert_eq!(target.bundle_identifier, None);
}

#[test]
fn macos_application_capture_target_round_trips_bundle_identifier() {
    let target = ApplicationCaptureTarget {
        platform: "macos".to_owned(),
        bundle_identifier: Some("com.example.player".to_owned()),
        executable_path: "/Applications/Player.app/Contents/MacOS/Player".to_owned(),
        executable_name: "Player".to_owned(),
        include_process_tree: true,
    };
    let bytes = rmp_serde::to_vec_named(&target).expect("macOS target must encode");
    let decoded: ApplicationCaptureTarget =
        rmp_serde::from_slice(&bytes).expect("macOS target must decode");

    assert_eq!(decoded, target);
}

#[test]
fn every_returning_plugin_stage_has_a_deterministic_failure_fixture() {
    let context = PluginFailureFixtureContext {
        instance_id: "fixture-plugin".to_owned(),
        instance_generation: 7,
        graph_revision: 11,
    };
    let stages = [
        PluginFailureStage::Initialize,
        PluginFailureStage::Restore,
        PluginFailureStage::Process,
        PluginFailureStage::Parameter,
        PluginFailureStage::Editor,
        PluginFailureStage::StateSave,
        PluginFailureStage::Ara,
    ];

    for stage in stages {
        let failure = PluginFailureFixture::returning(stage)
            .reject::<()>(&context)
            .expect_err("a returning fixture must reject deterministically");
        assert_eq!(failure.instance_generation, 7);
        assert_eq!(failure.graph_revision, 11);
        assert_eq!(failure.stage, stage);
        assert_eq!(failure.outcome, PluginFailureOutcome::Failed);
        assert!(failure.recoverable);
    }
}

#[test]
fn every_plugin_failure_category_maps_to_one_typed_terminal_outcome() {
    let context = PluginFailureFixtureContext {
        instance_id: "fixture-plugin".to_owned(),
        instance_generation: 7,
        graph_revision: 11,
    };
    let expected = [
        (
            PluginFailureCategory::PluginRejected,
            PluginFailureOutcome::Failed,
        ),
        (
            PluginFailureCategory::InvalidOutput,
            PluginFailureOutcome::Failed,
        ),
        (
            PluginFailureCategory::HostPanic,
            PluginFailureOutcome::Quarantined,
        ),
        (
            PluginFailureCategory::QueueOverflow,
            PluginFailureOutcome::Failed,
        ),
        (
            PluginFailureCategory::StaleGeneration,
            PluginFailureOutcome::Failed,
        ),
        (
            PluginFailureCategory::HostState,
            PluginFailureOutcome::Quarantined,
        ),
    ];

    for (category, outcome) in expected {
        let failure = PluginFailureFixture::category(category)
            .reject::<()>(&context)
            .expect_err("a category fixture must reject deterministically");
        assert_eq!(failure.category, category);
        assert_eq!(failure.outcome, outcome);
        assert_eq!(failure.recoverable, outcome == PluginFailureOutcome::Failed);
    }
}

#[test]
fn host_panic_fixture_catches_only_an_unwind_safe_non_realtime_callback() {
    let context = PluginFailureFixtureContext {
        instance_id: "fixture-plugin".to_owned(),
        instance_generation: 7,
        graph_revision: 11,
    };
    let success =
        PluginFailureFixture::catch_host_panic(PluginFailureStage::Editor, &context, || 42);
    assert_eq!(success, Ok(42));

    let failure =
        PluginFailureFixture::catch_host_panic(PluginFailureStage::Editor, &context, || {
            panic!("deterministic host-owned fixture panic")
        })
        .expect_err("the fixture panic must become a typed failure");
    assert_eq!(failure.category, PluginFailureCategory::HostPanic);
    assert_eq!(failure.stage, PluginFailureStage::Editor);
    assert_eq!(failure.outcome, PluginFailureOutcome::Quarantined);
    assert!(!failure.recoverable);
}

#[test]
fn malformed_plugin_failures_are_rejected_by_rust_deserialization() {
    let valid = serde_json::json!({
        "instance_id": "fixture-plugin",
        "instance_generation": 7,
        "graph_revision": 11,
        "category": "plugin-rejected",
        "stage": "initialize",
        "outcome": "failed",
        "recoverable": true,
        "diagnostic_id": "fixture:initialize",
        "message": "fixture rejection"
    });
    let mut missing_generation = valid.clone();
    missing_generation
        .as_object_mut()
        .expect("fixture JSON is an object")
        .remove("instance_generation");
    assert!(serde_json::from_value::<PluginRuntimeFailure>(missing_generation).is_err());

    let mut unknown_stage = valid.clone();
    unknown_stage["stage"] = serde_json::json!("native-crash");
    assert!(serde_json::from_value::<PluginRuntimeFailure>(unknown_stage).is_err());

    let mut extra_field = valid;
    extra_field["ambient_current_plugin"] = serde_json::json!(true);
    assert!(serde_json::from_value::<PluginRuntimeFailure>(extra_field).is_err());
}

#[test]
fn typescript_messagepack_fixtures_decode_as_rust_protocol_types() {
    let fixtures: Vec<MessagePackFixture> = serde_json::from_str(include_str!(
        "../../tests/fixtures/audio-host-messagepack.json"
    ))
    .expect("fixture manifest must be valid JSON");
    let typescript_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.producer == "typescript")
        .collect::<Vec<_>>();
    assert_eq!(typescript_fixtures.len(), 4);

    for fixture in typescript_fixtures {
        let bytes = decode_base64(&fixture.base64);
        let normalized = match fixture.wire_type.as_str() {
            "control-request" => serde_json::to_value(
                rmp_serde::from_slice::<ControlRequest>(&bytes)
                    .expect("TypeScript control request fixture must decode"),
            ),
            "control-response" => serde_json::to_value(
                rmp_serde::from_slice::<ControlResponse>(&bytes)
                    .expect("TypeScript control response fixture must decode"),
            ),
            "host-event" => serde_json::to_value(
                rmp_serde::from_slice::<HostEvent>(&bytes)
                    .expect("TypeScript host event fixture must decode"),
            ),
            wire_type => panic!("unexpected TypeScript fixture wire type: {wire_type}"),
        }
        .expect("decoded fixture must normalize to JSON");
        assert_eq!(
            normalized, fixture.normalized,
            "fixture {} drifted",
            fixture.name
        );
    }
}

#[test]
fn rust_messagepack_fixtures_match_named_struct_encoding() {
    let fixtures: Vec<MessagePackFixture> = serde_json::from_str(include_str!(
        "../../tests/fixtures/audio-host-messagepack.json"
    ))
    .expect("fixture manifest must be valid JSON");
    let rust_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.producer == "rust")
        .collect::<Vec<_>>();
    assert_eq!(rust_fixtures.len(), 4);

    for fixture in rust_fixtures {
        let bytes = decode_base64(&fixture.base64);
        let encoded = match fixture.wire_type.as_str() {
            "control-request" => {
                let value = rmp_serde::from_slice::<ControlRequest>(&bytes)
                    .expect("Rust control request fixture must decode");
                assert_eq!(
                    serde_json::to_value(&value).expect("fixture must normalize"),
                    fixture.normalized
                );
                rmp_serde::to_vec_named(&value)
            }
            "control-response" => {
                let value = rmp_serde::from_slice::<ControlResponse>(&bytes)
                    .expect("Rust control response fixture must decode");
                assert_eq!(
                    serde_json::to_value(&value).expect("fixture must normalize"),
                    fixture.normalized
                );
                rmp_serde::to_vec_named(&value)
            }
            "priority-response" => {
                let value = rmp_serde::from_slice::<PriorityResponse>(&bytes)
                    .expect("Rust priority response fixture must decode");
                assert_eq!(
                    serde_json::to_value(&value).expect("fixture must normalize"),
                    fixture.normalized
                );
                rmp_serde::to_vec_named(&value)
            }
            "host-event" => {
                let value = rmp_serde::from_slice::<HostEvent>(&bytes)
                    .expect("Rust host event fixture must decode");
                assert_eq!(
                    serde_json::to_value(&value).expect("fixture must normalize"),
                    fixture.normalized
                );
                rmp_serde::to_vec_named(&value)
            }
            wire_type => panic!("unexpected Rust fixture wire type: {wire_type}"),
        }
        .expect("Rust fixture must encode");
        assert_eq!(encoded, bytes, "fixture {} bytes drifted", fixture.name);
    }
}

fn encoded_hex(value: &impl Serialize) -> String {
    rmp_serde::to_vec_named(value)
        .unwrap()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
fn representative_wire_encodings_remain_byte_compatible() {
    let control = ControlRequest {
        request_id: 42,
        command: ControlCommand::Ping,
    };
    assert_eq!(
        encoded_hex(&control),
        "82aa726571756573745f69642aa7636f6d6d616e6481a474797065a470696e67"
    );

    let priority = PriorityRequest {
        request_id: 9,
        command: PriorityCommand::ParameterBoundary {
            command: ParameterCommand {
                session_epoch: 3,
                sequence: 17,
                target_kind: ParameterTargetKind::Plugin,
                runtime_handle: 5,
                parameter_token: 11,
                target_generation: 7,
                value: 0.25,
                gesture: ParameterGesture::Perform,
            },
        },
    };
    assert_eq!(
        encoded_hex(&priority),
        concat!(
            "82aa726571756573745f696409a7636f6d6d616e6482a474797065b2706172616d",
            "657465722d626f756e64617279a7636f6d6d616e6488ad73657373696f6e5f6570",
            "6f636803a873657175656e636511ab7461726765745f6b696e64a6706c7567696e",
            "ae72756e74696d655f68616e646c6505af706172616d657465725f746f6b656e0b",
            "b17461726765745f67656e65726174696f6e07a576616c7565cb3fd00000000000",
            "00a767657374757265a7706572666f726d"
        )
    );
}

#[test]
fn midi_recording_stop_uses_the_desktop_wire_field() {
    let response = ControlResponse {
        request_id: 7,
        result: ControlResult::MidiRecordingStopped {
            recording: MidiRecordingResult {
                takes: vec![MidiRecordingTakeResult {
                    path: "/swap/take.midijournal".to_owned(),
                    source_id: "source-1".to_owned(),
                    clip_id: "clip-1".to_owned(),
                    track_id: "track-1".to_owned(),
                    event_count: 4,
                    dropped_events: 1,
                }],
            },
        },
    };
    let bytes = rmp_serde::to_vec_named(&response).expect("response must encode");
    let wire = rmp_serde::from_slice::<serde_json::Value>(&bytes)
        .expect("response must decode as a MessagePack map");

    assert_eq!(wire["result"]["type"], "midi-recording-stopped");
    assert_eq!(
        wire["result"]["midi_recording"]["takes"][0]["event_count"],
        4
    );
    assert!(wire["result"].get("recording").is_none());
}

#[test]
fn messagepack_frame_round_trips() {
    let request = ControlRequest {
        request_id: 42,
        command: ControlCommand::PrepareGraph {
            meta: RpcRequestMeta {
                protocol_version: IPC_PROTOCOL_VERSION,
                request_id: "round-trip".into(),
                target: None,
                expected_revision: None,
                mutation: None,
            },
            request: Box::new(PrepareGraphRequest {
                helper_epoch: "42".into(),
                project_graph: ResourceRef {
                    kind: ResourceKind::ProjectGraph,
                    id: "graph".into(),
                    epoch: "project".into(),
                    generation: 1,
                },
                base_revision: 0,
                graph_revision: 1,
                graph: empty_graph(),
            }),
        },
    };
    let mut bytes = Vec::new();
    write_message(&mut bytes, &request).unwrap();
    assert_eq!(
        read_message::<ControlRequest>(&mut bytes.as_slice()).unwrap(),
        request
    );
}

#[test]
fn plugin_editor_commands_use_the_documented_wire_context() {
    let context = PluginEditorContext {
        channel_name: "主唱".to_owned(),
        channel_color: "#58c6c2".to_owned(),
        plugin_name: "Heron Gain".to_owned(),
        appearance: PluginEditorAppearance {
            theme: PluginEditorTheme::Light,
            locale: PluginEditorLocale::ZhCmnHansCn,
        },
    };
    for command in [
        ControlCommand::OpenPluginEditor {
            instance_id: "gain-1".to_owned(),
            preference: PluginEditorPreference {
                mode: PluginEditorMode::Parameters,
                zoom_percent: 200,
            },
            context: context.clone(),
        },
        ControlCommand::ConfigurePluginEditorAppearance {
            appearance: context.appearance,
        },
    ] {
        let bytes = rmp_serde::to_vec_named(&command).unwrap();
        let wire: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
        let appearance = serde_json::json!({"theme": "light", "locale": "zh-cmn-Hans-CN"});
        match &command {
            ControlCommand::OpenPluginEditor { .. } => {
                assert_eq!(wire["type"], "open-plugin-editor");
                assert_eq!(wire["instance_id"], "gain-1");
                assert_eq!(
                    wire["preference"],
                    serde_json::json!({"mode": "parameters", "zoom_percent": 200})
                );
                assert_eq!(
                    wire["context"],
                    serde_json::json!({
                        "channel_name": "主唱", "channel_color": "#58c6c2",
                        "plugin_name": "Heron Gain", "appearance": appearance
                    })
                );
            }
            ControlCommand::ConfigurePluginEditorAppearance { .. } => {
                assert_eq!(wire["type"], "configure-plugin-editor-appearance");
                assert_eq!(wire["appearance"], appearance);
            }
            _ => unreachable!(),
        }
        assert_eq!(
            rmp_serde::from_slice::<ControlCommand>(&bytes).unwrap(),
            command
        );
    }
}

#[test]
fn legacy_open_editor_payload_defaults_its_new_context() {
    let payload = serde_json::json!({
        "type": "open-plugin-editor",
        "instance_id": "legacy",
        "preference": { "mode": "native", "zoom_percent": 100 }
    });
    assert_eq!(
        serde_json::from_value::<ControlCommand>(payload).unwrap(),
        ControlCommand::OpenPluginEditor {
            instance_id: "legacy".to_owned(),
            preference: PluginEditorPreference::default(),
            context: PluginEditorContext::default(),
        }
    );
}

#[test]
fn graph_transaction_wire_keeps_lossless_epochs_and_resource_authority() {
    let engine = ResourceRef {
        kind: ResourceKind::AudioEngine,
        id: "engine".to_owned(),
        epoch: u64::MAX.to_string(),
        generation: 2,
    };
    let project_graph = ResourceRef {
        kind: ResourceKind::ProjectGraph,
        id: "graph".to_owned(),
        epoch: "main-epoch".to_owned(),
        generation: 4,
    };
    let command = ControlCommand::PrepareGraph {
        meta: RpcRequestMeta {
            protocol_version: IPC_PROTOCOL_VERSION,
            request_id: "request-1".to_owned(),
            target: Some(engine),
            expected_revision: Some(7),
            mutation: Some(RpcMutationMeta {
                operation_id: "operation-1".to_owned(),
                idempotency_key: "graph:8".to_owned(),
            }),
        },
        request: Box::new(PrepareGraphRequest {
            helper_epoch: u64::MAX.to_string(),
            project_graph,
            base_revision: 7,
            graph_revision: 8,
            graph: empty_graph(),
        }),
    };

    let bytes = rmp_serde::to_vec_named(&command).expect("graph transaction must encode");
    let wire: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
    assert_eq!(wire["type"], "prepare-graph");
    assert_eq!(
        wire["meta"]["target"],
        serde_json::json!({
            "kind": "audio-engine", "id": "engine", "epoch": "18446744073709551615", "generation": 2
        })
    );
    assert_eq!(wire["meta"]["expectedRevision"], 7);
    assert_eq!(
        wire["meta"]["mutation"],
        serde_json::json!({
            "operationId": "operation-1", "idempotencyKey": "graph:8"
        })
    );
    assert_eq!(wire["request"]["helperEpoch"], "18446744073709551615");
    assert_eq!(
        wire["request"]["projectGraph"],
        serde_json::json!({
            "kind": "project-graph", "id": "graph", "epoch": "main-epoch", "generation": 4
        })
    );
    assert_eq!(wire["request"]["baseRevision"], 7);
    assert_eq!(wire["request"]["graphRevision"], 8);
    assert_eq!(
        rmp_serde::from_slice::<ControlCommand>(&bytes).expect("graph transaction must decode"),
        command
    );
}

#[test]
fn full_graph_requests_preserve_runtime_defaults_without_the_removed_patch_protocol() {
    let mut wire = serde_json::to_value(empty_graph()).unwrap();
    wire.as_object_mut().unwrap().remove("project_end_tick");
    wire.as_object_mut().unwrap().remove("latency_policy");
    wire["plugins"] = serde_json::json!([{
        "instance_id": "effect", "channel_id": "channel", "role": "insert",
        "slot_order": 0, "enabled": true, "latency_samples": 0, "tail_samples": 0
    }]);
    let graph: LiveMixerGraph = serde_json::from_value(wire).unwrap();
    assert_eq!(graph.project_end_tick, 61_440);
    assert_eq!(graph.latency_policy, LiveLatencyPolicy::Normal);
    assert_eq!(graph.plugins[0].instance_generation, 1);
    assert_eq!(graph.plugins[0].audio_mode, PluginAudioMode::Stereo);
    assert!(graph.plugins[0].aux_input_buses.is_empty());
    assert!(!graph.plugins[0].duplicate_mono_output);
    assert!(
        serde_json::from_value::<ControlCommand>(serde_json::json!({
            "type": "update-graph", "update": { "type": "replace", "revision": 1, "graph": graph }
        }))
        .is_err()
    );
}

#[test]
fn audio_wire_distinguishes_session_input_and_output_sample_rates() {
    let command = ControlCommand::StartAudioEngine {
        config: AudioEngineConfig {
            backend: "mock".to_owned(),
            input_device_id: "input".to_owned(),
            output_device_id: "output".to_owned(),
            buffer_size: 128,
            session_sample_rate: Some(44_100),
        },
    };
    let command_bytes = rmp_serde::to_vec_named(&command).unwrap();
    let wire: serde_json::Value = rmp_serde::from_slice(&command_bytes).unwrap();
    assert_eq!(wire["type"], "start-audio-engine");
    assert_eq!(wire["config"]["session_sample_rate"], 44_100);
    assert_eq!(
        rmp_serde::from_slice::<ControlCommand>(&command_bytes).unwrap(),
        command
    );

    let runtime = AudioRuntime {
        state: "running".to_owned(),
        requested_buffer_size: Some(128),
        sample_rate: Some(44_100),
        input_sample_rate: Some(48_000),
        output_sample_rate: Some(48_000),
        input_buffer_size: Some(128),
        output_buffer_size: Some(128),
        ring_buffer_capacity_frames: Some(512),
        ring_buffer_fill_frames: Some(256),
        input_latency_ms: Some(1.0),
        output_latency_ms: Some(1.0),
        ring_buffer_latency_ms: Some(1.0),
        engine_latency_ms: Some(2.0),
        estimated_round_trip_latency_ms: Some(5.0),
        xruns: 0,
        clock_sync: "shared".to_owned(),
        buffer_fallback: false,
    };
    let runtime_bytes = rmp_serde::to_vec_named(&runtime).unwrap();
    let wire: serde_json::Value = rmp_serde::from_slice(&runtime_bytes).unwrap();
    assert_eq!(wire["sample_rate"], 44_100);
    assert_eq!(wire["input_sample_rate"], 48_000);
    assert_eq!(wire["output_sample_rate"], 48_000);
    assert_eq!(
        rmp_serde::from_slice::<AudioRuntime>(&runtime_bytes).unwrap(),
        runtime
    );
}

#[test]
fn mixer_send_taps_use_stable_kebab_case_wire_values() {
    for (tap, wire_value) in [
        (LiveMixerSendTap::Pre, "pre"),
        (LiveMixerSendTap::Post, "post"),
        (LiveMixerSendTap::PostPan, "post-pan"),
    ] {
        let bytes = rmp_serde::to_vec(&tap).unwrap();
        assert_eq!(rmp_serde::from_slice::<String>(&bytes).unwrap(), wire_value);
        assert_eq!(
            rmp_serde::from_slice::<LiveMixerSendTap>(&bytes).unwrap(),
            tap
        );
    }

    let unknown = rmp_serde::to_vec(&"unknown").unwrap();
    assert!(rmp_serde::from_slice::<LiveMixerSendTap>(&unknown).is_err());
}

#[test]
fn rejects_oversized_frame_before_allocating() {
    let mut bytes = ((MAX_MESSAGE_BYTES as u32) + 1).to_be_bytes().to_vec();
    bytes.extend_from_slice(&[0; 4]);
    assert!(matches!(
        read_message::<ControlRequest>(&mut bytes.as_slice()),
        Err(ProtocolError::MessageTooLarge(_))
    ));
}

fn empty_graph() -> LiveMixerGraph {
    LiveMixerGraph {
        sample_rate: 48_000,
        project_end_tick: 61_440,
        latency_policy: LiveLatencyPolicy::Normal,
        channels: vec![],
        sends: vec![],
        clips: vec![],
        plugins: vec![],
        midi_clips: vec![],
        tempo_events: vec![LiveTempoEvent {
            tick: 0,
            beats_per_minute: 120.0,
        }],
        time_signature_events: vec![LiveTimeSignatureEvent {
            tick: 0,
            numerator: 4,
            denominator: 4,
        }],
    }
}

#[test]
fn binary_payloads_expose_bytes_only_when_they_are_inline() {
    assert_eq!(BinaryPayload::default(), BinaryPayload::inline(Vec::new()));
    assert_eq!(
        BinaryPayload::inline(vec![1, 2, 3]).as_inline(),
        Some(&[1, 2, 3][..])
    );

    let reference = SharedBlobRef {
        session_epoch: 1,
        region_id: 2,
        region_generation: 3,
        slot: 4,
        allocation_generation: 5,
        offset: 6,
        length: 7,
        lease_id: 8,
    };
    assert_eq!(BinaryPayload::Shared { reference }.as_inline(), None);
    assert_eq!(
        BinaryPayload::Attachment {
            index: 0,
            offset: 0,
            length: 0,
        }
        .as_inline(),
        None
    );
}

#[test]
fn a_frame_is_length_prefixed_in_big_endian() {
    let mut bytes = Vec::new();
    write_message(
        &mut bytes,
        &ControlRequest {
            request_id: 1,
            command: ControlCommand::Ping,
        },
    )
    .unwrap();

    let length = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
    assert_eq!(length, bytes.len() - 4);
}

#[test]
fn consecutive_frames_are_read_back_in_order() {
    let mut bytes = Vec::new();
    for request_id in 0..3 {
        write_message(
            &mut bytes,
            &ControlRequest {
                request_id,
                command: ControlCommand::Ping,
            },
        )
        .unwrap();
    }

    let mut reader = bytes.as_slice();
    for request_id in 0..3 {
        assert_eq!(
            read_message::<ControlRequest>(&mut reader)
                .unwrap()
                .request_id,
            request_id
        );
    }
    assert!(reader.is_empty());
}

#[test]
fn a_truncated_frame_is_reported_as_an_io_error() {
    let mut bytes = Vec::new();
    write_message(
        &mut bytes,
        &ControlRequest {
            request_id: 1,
            command: ControlCommand::Ping,
        },
    )
    .unwrap();
    bytes.truncate(bytes.len() - 1);

    assert!(matches!(
        read_message::<ControlRequest>(&mut bytes.as_slice()),
        Err(ProtocolError::Io(_))
    ));
}

#[test]
fn a_frame_that_is_not_the_expected_message_is_reported_as_a_decode_error() {
    let mut bytes = Vec::new();
    write_message(&mut bytes, &"not a control request".to_owned()).unwrap();

    assert!(matches!(
        read_message::<ControlRequest>(&mut bytes.as_slice()),
        Err(ProtocolError::Decode(_))
    ));
}

#[test]
fn a_write_that_fails_midway_surfaces_the_io_error() {
    struct FullDisk;

    impl std::io::Write for FullDisk {
        fn write(&mut self, _buffer: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("no space left on device"))
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let error = write_message(
        &mut FullDisk,
        &ControlRequest {
            request_id: 1,
            command: ControlCommand::Ping,
        },
    )
    .expect_err("a failing writer should surface an error");

    assert!(matches!(error, ProtocolError::Io(_)));
    assert!(error.to_string().starts_with("helper protocol I/O failed"));
}

#[test]
fn protocol_errors_describe_themselves() {
    assert_eq!(
        ProtocolError::MessageTooLarge(70_000_000).to_string(),
        "helper message exceeds 64 MiB: 70000000"
    );

    let decode = read_message::<ControlRequest>(&mut [0, 0, 0, 1, 0xc1].as_slice())
        .expect_err("0xc1 is never a valid MessagePack marker");
    assert!(
        decode
            .to_string()
            .starts_with("helper message decoding failed")
    );
}
