//! Off-callback graph compilation shared by document preparation and plug-in refresh.

use crate::engine::{CompiledGraphBuild, GraphBuildInput, compile_graph_build};

pub(crate) async fn compile(input: GraphBuildInput) -> Result<CompiledGraphBuild, String> {
    tokio::task::spawn_blocking(move || {
        compile_graph_build(input).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("graph compilation task failed: {error}"))?
}

#[cfg(test)]
#[allow(clippy::wildcard_imports)]
mod tests {
    use super::*;
    use crate::engine::{
        AudioEngine, GRAPH_TEST_LOCK, NativeMixerChannel, NativeMixerGraph, PublishOutcome,
    };
    use heron_dsp_runtime::tempo::{TempoEvent, TimeSignatureEvent};

    fn minimal_graph(generation: u64) -> NativeMixerGraph {
        NativeMixerGraph {
            generation,
            sample_rate: 48_000,
            project_end_tick: 61_440,
            latency_policy: heron_audio_engine::NativeLatencyPolicy::Normal,
            channels: vec![
                NativeMixerChannel {
                    id: "audio".into(),
                    name: "Audio".into(),
                    color: String::new(),
                    kind: "audio".into(),
                    system_role: None,
                    gain_db: 0.0,
                    pan: 0.0,
                    muted: false,
                    soloed: false,
                    output_index: Some(2),
                    output_bus: None,
                    record_armed: false,
                    input_monitoring: false,
                    input_source: Some("hardware".into()),
                    input_channels: vec![1, 2],
                    application_capture: None,
                    hardware_output_channels: vec![],
                    midi_input_port_id: None,
                    midi_input_channel: None,
                },
                NativeMixerChannel {
                    id: "master".into(),
                    name: "Master".into(),
                    color: String::new(),
                    kind: "master".into(),
                    system_role: None,
                    gain_db: 0.0,
                    pan: 0.0,
                    muted: false,
                    soloed: false,
                    output_index: None,
                    output_bus: None,
                    record_armed: false,
                    input_monitoring: false,
                    input_source: None,
                    input_channels: vec![],
                    application_capture: None,
                    hardware_output_channels: vec![],
                    midi_input_port_id: None,
                    midi_input_channel: None,
                },
                NativeMixerChannel {
                    id: "output".into(),
                    name: "Output".into(),
                    color: String::new(),
                    kind: "output".into(),
                    system_role: None,
                    gain_db: 0.0,
                    pan: 0.0,
                    muted: false,
                    soloed: false,
                    output_index: None,
                    output_bus: None,
                    record_armed: false,
                    input_monitoring: false,
                    input_source: None,
                    input_channels: vec![],
                    application_capture: None,
                    hardware_output_channels: vec![1, 2],
                    midi_input_port_id: None,
                    midi_input_channel: None,
                },
            ],
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
        }
    }

    #[test]
    fn newer_build_generation_discards_stale_publish() {
        let _guard = GRAPH_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let engine = AudioEngine::new();
        let first = engine
            .begin_graph_build(minimal_graph(1))
            .expect("first begin");
        let first_generation = first.build_generation();
        // A newer begin must win publication even if the older compile finishes later.
        let second = engine
            .begin_graph_build(minimal_graph(2))
            .expect("second begin");
        assert!(second.build_generation() > first_generation);
        assert_eq!(
            engine.latest_build_generation_for_test(),
            second.build_generation()
        );

        let stale = compile_graph_build(first).expect("stale compile");
        assert_eq!(
            engine.publish_mixer_runtime(stale).expect("stale publish"),
            PublishOutcome::Superseded
        );

        let current = compile_graph_build(second).expect("current compile");
        assert_eq!(
            engine
                .publish_mixer_runtime(current)
                .expect("current publish"),
            PublishOutcome::Published
        );
    }

    #[test]
    fn graph_builds_compile_on_the_blocking_pool() {
        let _guard = GRAPH_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let engine = AudioEngine::new();
        let input = engine.begin_graph_build(minimal_graph(3)).expect("begin");
        let built = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(compile(input))
            .expect("compile");
        assert_eq!(
            engine.publish_mixer_runtime(built).expect("publish"),
            PublishOutcome::Published
        );
    }

    #[test]
    fn preparing_and_compiling_do_not_replace_the_committed_recovery_graph() {
        let _guard = GRAPH_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let engine = AudioEngine::new();
        engine.set_last_native_graph_for_test(None);
        let input = engine
            .begin_graph_build(minimal_graph(41))
            .expect("prepare");
        assert_eq!(engine.last_native_graph_generation_for_test(), None);

        let built = compile_graph_build(input).expect("compile");
        assert_eq!(engine.last_native_graph_generation_for_test(), None);

        assert_eq!(
            engine.publish_mixer_runtime(built).expect("activate"),
            PublishOutcome::Published
        );
        assert_eq!(engine.last_native_graph_generation_for_test(), Some(41));
        engine.set_last_native_graph_for_test(None);
    }
}
