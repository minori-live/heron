//! MessagePack project-graph payload used when the desktop loads or replaces a mix.
//!
//! The payload is a `PrepareGraphRequest`: the same named-MessagePack body the
//! renderer sends across the N-API boundary. Track counts are 8, 32, and 128,
//! each with two clips and two insert slots.

use std::{hint::black_box, time::Duration};

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use heron_dsp_runtime::protocol::{
    LiveLatencyPolicy, LiveMixerChannel, LiveMixerClip, LiveMixerGraph, LiveMixerSend,
    LiveMixerSendTap, LivePluginInstance, PluginAudioMode, PrepareGraphRequest, ResourceKind,
    ResourceRef,
};
use heron_dsp_runtime::tempo::{TempoEvent, TimeSignatureEvent};

fn channel(index: usize, kind: &str, output: Option<String>) -> LiveMixerChannel {
    LiveMixerChannel {
        id: format!("{kind}-{index}"),
        name: format!("Channel {index}"),
        color: "#88a".to_owned(),
        kind: kind.to_owned(),
        system_role: None,
        gain_db: -3.0,
        pan: 0.0,
        muted: false,
        soloed: false,
        output_channel_id: output,
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
            vec![0, 1]
        } else {
            Vec::new()
        },
    }
}

fn graph(tracks: usize) -> PrepareGraphRequest {
    let mut channels = Vec::with_capacity(tracks + 2);
    for index in 0..tracks {
        channels.push(channel(index, "audio", Some("output-0".to_owned())));
    }
    channels.push(channel(0, "master", None));
    channels.push(channel(0, "output", None));

    let clips = (0..tracks * 2)
        .map(|index| LiveMixerClip {
            id: format!("clip-{index}"),
            channel_id: format!("audio-{}", index % tracks),
            start_frame: (index as i64) * 48_000,
            source_offset_frames: 0,
            length_frames: 48_000 * 30,
            fade_in_frames: 256,
            fade_out_frames: 1_024,
            path: format!("assets/take-{index}.wav"),
        })
        .collect();
    let plugins = (0..tracks * 2)
        .map(|index| LivePluginInstance {
            instance_id: format!("plugin-{index}"),
            instance_generation: 1,
            channel_id: format!("audio-{}", index % tracks),
            role: "insert".to_owned(),
            slot_order: (index / tracks) as u32,
            audio_mode: PluginAudioMode::Stereo,
            duplicate_mono_output: false,
            enabled: true,
            aux_input_buses: Vec::new(),
            latency_samples: 64,
            tail_samples: Some(24_000),
        })
        .collect();
    let sends = (0..tracks.min(8))
        .map(|index| LiveMixerSend {
            id: format!("send-{index}"),
            source_channel_id: format!("audio-{index}"),
            target_channel_id: None,
            target_bus: Some((index % 4) as u32),
            target_format: None,
            enabled: true,
            tap: LiveMixerSendTap::Post,
            level_db: -12.0,
        })
        .collect();

    PrepareGraphRequest {
        helper_epoch: "bench-epoch".to_owned(),
        project_graph: ResourceRef {
            kind: ResourceKind::ProjectGraph,
            id: "graph-1".to_owned(),
            epoch: "project-epoch".to_owned(),
            generation: 4,
        },
        base_revision: 7,
        graph_revision: 8,
        graph: LiveMixerGraph {
            sample_rate: 48_000,
            project_end_tick: 960 * 4 * 64,
            latency_policy: LiveLatencyPolicy::Normal,
            channels,
            sends,
            clips,
            plugins,
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
    }
}

fn bench_round_trip(c: &mut Criterion) {
    let mut group = c.benchmark_group("dsp-runtime/project_graph/msgpack");
    group
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(3))
        .sample_size(50)
        .noise_threshold(0.03);
    for &tracks in &[8_usize, 32, 128] {
        let request = graph(tracks);
        let encoded = rmp_serde::to_vec_named(&request).expect("graph encodes");
        group.throughput(Throughput::Bytes(encoded.len() as u64));
        group.bench_function(
            format!("encode/tracks={tracks}/bytes={}", encoded.len()),
            |bencher| {
                bencher.iter(|| {
                    black_box(rmp_serde::to_vec_named(black_box(&request)).expect("encode"))
                });
            },
        );
        group.bench_function(
            format!("decode/tracks={tracks}/bytes={}", encoded.len()),
            |bencher| {
                bencher.iter(|| {
                    black_box(
                        rmp_serde::from_slice::<PrepareGraphRequest>(black_box(&encoded))
                            .expect("decode"),
                    )
                });
            },
        );
    }
    group.finish();
}

criterion_group!(benches, bench_round_trip);
criterion_main!(benches);
