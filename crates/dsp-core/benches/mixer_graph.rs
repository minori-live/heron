use std::{hint::black_box, time::Duration};

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use heron_dsp_core::mixer::{
    ChannelKind, ChannelPeak, ChannelSpec, GraphError, HardwareOutputFrame, MixerGraph,
    RouteTarget, SendSpec, SendTap, StereoFrame,
};

#[derive(Clone, Copy)]
enum Topology {
    Direct,
    Cascaded,
    SendHeavy,
}

impl Topology {
    fn label(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Cascaded => "cascaded",
            Self::SendHeavy => "send-heavy",
        }
    }
}

fn scenario(
    tracks: usize,
    buses: usize,
    sends_per_track: usize,
    _topology: Topology,
    soloed: bool,
) -> (Vec<ChannelSpec>, Vec<SendSpec>) {
    let master = tracks + buses;
    let output = master + 1;
    let mut channels = Vec::with_capacity(master + 2);
    for index in 0..tracks {
        channels.push(ChannelSpec {
            id: format!("audio-{index}"),
            kind: ChannelKind::Audio,
            gain_db: -3.0,
            pan: (index % 5) as f32 * 0.2 - 0.4,
            muted: index % 17 == 16,
            soloed: soloed && index == 0,
            output: Some(RouteTarget::Output(output)),
            input_bus: None,
            hardware_output: None,
        });
    }
    for index in 0..buses {
        channels.push(ChannelSpec {
            id: format!("aux-{index}"),
            kind: ChannelKind::Aux,
            gain_db: -1.0,
            pan: 0.0,
            muted: false,
            soloed: false,
            output: Some(RouteTarget::Output(output)),
            input_bus: Some([index, index]),
            hardware_output: None,
        });
    }
    channels.push(ChannelSpec {
        id: "master".to_owned(),
        kind: ChannelKind::Master,
        gain_db: 0.0,
        pan: 0.0,
        muted: false,
        soloed: false,
        output: None,
        input_bus: None,
        hardware_output: None,
    });
    channels.push(ChannelSpec {
        id: "output".to_owned(),
        kind: ChannelKind::Output,
        gain_db: 0.0,
        pan: 0.0,
        muted: false,
        soloed: false,
        output: None,
        input_bus: None,
        hardware_output: Some([0, 1]),
    });

    let mut sends = Vec::with_capacity(tracks.saturating_mul(sends_per_track));
    if buses > 0 {
        for source in 0..tracks {
            for send_index in 0..sends_per_track {
                sends.push(SendSpec {
                    id: format!("send-{source}-{send_index}"),
                    source,
                    target: RouteTarget::Bus((source + send_index) % buses),
                    enabled: true,
                    tap: if send_index % 2 == 0 {
                        SendTap::Pre
                    } else {
                        SendTap::Post
                    },
                    level_db: -12.0,
                });
            }
        }
    }
    (channels, sends)
}

fn process_block(
    graph: &mut MixerGraph,
    inputs: &[StereoFrame],
    block_frames: usize,
) -> HardwareOutputFrame {
    let mut result = [0.0; 32];
    for _ in 0..block_frames {
        result = graph.process_frame(black_box(inputs));
    }
    result
}

fn process_block_api(
    graph: &mut MixerGraph,
    channel_sources: &mut [StereoFrame],
    output: &mut [HardwareOutputFrame],
) {
    graph
        .process_block_with_sources(channel_sources, output, &mut |_, _, _| {})
        .expect("benchmark block must be prepared");
}

fn prepared_block_graph(
    sample_rate: u32,
    channels: Vec<ChannelSpec>,
    sends: Vec<SendSpec>,
    block_frames: usize,
) -> MixerGraph {
    let mut graph = MixerGraph::new(sample_rate, channels, sends).expect("benchmark graph");
    graph.prepare_block_processing(block_frames);
    graph
}

fn channel_major_sources(
    graph: &MixerGraph,
    tracks: usize,
    block_frames: usize,
) -> Vec<StereoFrame> {
    // Scenario helper places audio tracks at channel indices `0..tracks`.
    let mut sources = vec![[0.0, 0.0]; graph.channel_count() * block_frames];
    for track in 0..tracks {
        let start = track * block_frames;
        sources[start..start + block_frames].fill([0.125, -0.125]);
    }
    sources
}

fn bench_graph_build(c: &mut Criterion) {
    let mut group = c.benchmark_group("dsp-core/mixer_graph/build");
    group
        .warm_up_time(Duration::from_secs(3))
        .measurement_time(Duration::from_secs(5))
        .sample_size(100)
        .noise_threshold(0.03);

    for &(tracks, buses, sends_per_track, topology) in &[
        (1, 0, 0, Topology::Direct),
        (8, 4, 1, Topology::Cascaded),
        (32, 4, 1, Topology::SendHeavy),
        (128, 16, 4, Topology::SendHeavy),
    ] {
        let (channels, sends) = scenario(tracks, buses, sends_per_track, topology, true);
        let id = format!(
            "{}/tracks={tracks}/buses={buses}/sends={}",
            topology.label(),
            sends.len()
        );
        group.bench_function(id, |bencher| {
            bencher.iter(|| {
                black_box(
                    MixerGraph::new(48_000, channels.clone(), sends.clone())
                        .expect("benchmark graph must be valid"),
                )
            });
        });
    }

    let (mut channels, sends) = scenario(32, 4, 0, Topology::Cascaded, false);
    channels[32].input_bus = Some([0, 0]);
    channels[32 + 3].input_bus = Some([3, 3]);
    let mut sends = sends;
    sends.push(SendSpec {
        id: "cycle-a".to_owned(),
        source: 32,
        target: RouteTarget::Bus(3),
        enabled: true,
        tap: SendTap::Post,
        level_db: 0.0,
    });
    sends.push(SendSpec {
        id: "cycle-b".to_owned(),
        source: 35,
        target: RouteTarget::Bus(0),
        enabled: true,
        tap: SendTap::Post,
        level_db: 0.0,
    });
    group.bench_function("reject-routing-cycle/channels=37", |bencher| {
        bencher.iter(|| {
            let result = MixerGraph::new(48_000, channels.clone(), sends.clone());
            assert!(matches!(result, Err(GraphError::RoutingCycle)));
        });
    });
    group.finish();
}

fn bench_process_complexity(c: &mut Criterion) {
    let mut group = c.benchmark_group("dsp-core/mixer_graph/process_complexity");
    group
        .warm_up_time(Duration::from_secs(3))
        .measurement_time(Duration::from_secs(5))
        .sample_size(100)
        .noise_threshold(0.03)
        .throughput(Throughput::Elements(256));

    for &sample_rate in &[48_000, 96_000] {
        for &(tracks, buses, sends_per_track, topology) in &[
            (1, 0, 0, Topology::Direct),
            (8, 0, 0, Topology::Direct),
            (32, 4, 0, Topology::Cascaded),
            (32, 4, 1, Topology::SendHeavy),
            (128, 16, 4, Topology::SendHeavy),
        ] {
            let (channels, sends) = scenario(tracks, buses, sends_per_track, topology, false);
            let mut graph = MixerGraph::new(sample_rate, channels, sends).expect("benchmark graph");
            let inputs = vec![[0.125, -0.125]; tracks];
            let parameter = format!(
                "{}Hz/{}/tracks={tracks}/buses={buses}/sends-per-track={sends_per_track}",
                sample_rate,
                topology.label()
            );
            group.bench_with_input(
                BenchmarkId::new("block=256", parameter),
                &256_usize,
                |bencher, block_frames| {
                    bencher.iter(|| black_box(process_block(&mut graph, &inputs, *block_frames)));
                },
            );
        }
    }
    group.finish();
}

fn bench_process_block_api(c: &mut Criterion) {
    let mut group = c.benchmark_group("dsp-core/mixer_graph/process_block_with_sources");
    group
        .warm_up_time(Duration::from_secs(3))
        .measurement_time(Duration::from_secs(5))
        .sample_size(100)
        .noise_threshold(0.03)
        .throughput(Throughput::Elements(256));

    for &sample_rate in &[48_000, 96_000] {
        for &(tracks, buses, sends_per_track, topology) in &[
            (1, 0, 0, Topology::Direct),
            (8, 0, 0, Topology::Direct),
            (32, 4, 0, Topology::Cascaded),
            (32, 4, 1, Topology::SendHeavy),
            (128, 16, 4, Topology::SendHeavy),
        ] {
            let (channels, sends) = scenario(tracks, buses, sends_per_track, topology, false);
            let mut graph = prepared_block_graph(sample_rate, channels, sends, 256);
            let mut channel_sources = channel_major_sources(&graph, tracks, 256);
            let mut output = vec![[0.0; 32]; 256];
            let parameter = format!(
                "{}Hz/{}/tracks={tracks}/buses={buses}/sends-per-track={sends_per_track}",
                sample_rate,
                topology.label()
            );
            group.bench_with_input(
                BenchmarkId::new("block=256", parameter),
                &256_usize,
                |bencher, _block_frames| {
                    bencher.iter(|| {
                        process_block_api(&mut graph, &mut channel_sources, &mut output);
                        black_box(&output);
                    });
                },
            );
        }
    }
    group.finish();
}

fn bench_block_sizes_and_branches(c: &mut Criterion) {
    let mut group = c.benchmark_group("dsp-core/mixer_graph/block_and_branches");
    group
        .warm_up_time(Duration::from_secs(3))
        .measurement_time(Duration::from_secs(5))
        .sample_size(100)
        .noise_threshold(0.03);

    for &block_frames in &[64_usize, 256, 1_024] {
        group.throughput(Throughput::Elements(block_frames as u64));
        for &soloed in &[false, true] {
            let (channels, sends) = scenario(32, 4, 1, Topology::SendHeavy, soloed);
            let mut graph = MixerGraph::new(48_000, channels, sends).expect("benchmark graph");
            let inputs = vec![[0.25, 0.125]; 32];
            let parameter = format!(
                "block={block_frames}/solo={}",
                if soloed { "on" } else { "off" }
            );
            group.bench_function(parameter, |bencher| {
                bencher.iter(|| black_box(process_block(&mut graph, &inputs, block_frames)));
            });
        }
    }
    group.finish();
}

fn bench_realtime_budget(c: &mut Criterion) {
    let mut group = c.benchmark_group("dsp-core/mixer_graph/realtime_budget");
    group
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(3))
        .sample_size(50)
        .noise_threshold(0.03);

    for &(tracks, buses, sends_per_track, topology) in &[
        (8_usize, 0, 0, Topology::Direct),
        (32, 0, 0, Topology::Direct),
        (32, 4, 1, Topology::SendHeavy),
        (128, 0, 0, Topology::Direct),
        (128, 16, 4, Topology::SendHeavy),
    ] {
        for &block_frames in &[64_usize, 128, 512] {
            group.throughput(Throughput::Elements(block_frames as u64));
            let (channels, sends) = scenario(tracks, buses, sends_per_track, topology, false);
            let mut graph = prepared_block_graph(48_000, channels, sends, block_frames);
            let mut channel_sources = channel_major_sources(&graph, tracks, block_frames);
            let mut output = vec![[0.0; 32]; block_frames];
            let budget_us = (block_frames as u64) * 1_000_000 / 48_000;
            group.bench_function(
                format!(
                    "48kHz/{}/tracks={tracks}/buses={buses}/sends-per-track={sends_per_track}/block={block_frames}/budget={budget_us}us",
                    topology.label()
                ),
                |bencher| {
                    bencher.iter(|| {
                        process_block_api(&mut graph, &mut channel_sources, &mut output);
                        black_box(&output);
                    });
                },
            );
        }
    }
    group.finish();
}

fn bench_automation(c: &mut Criterion) {
    let mut group = c.benchmark_group("dsp-core/mixer_graph/automation");
    group
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(3))
        .sample_size(50)
        .noise_threshold(0.03)
        .throughput(Throughput::Elements(128));

    for &tracks in &[8_usize, 32, 128] {
        let (channels, sends) = scenario(tracks, 0, 0, Topology::Direct, false);
        let mut settled = MixerGraph::new(48_000, channels.clone(), sends.clone()).expect("graph");
        let mut automated = MixerGraph::new(48_000, channels, sends).expect("graph");
        let inputs = vec![[0.125, -0.125]; tracks];
        group.bench_function(format!("settled/tracks={tracks}/block=128"), |bencher| {
            bencher.iter(|| black_box(process_block(&mut settled, &inputs, 128)));
        });
        let mut gain = -12.0_f32;
        group.bench_function(
            format!("ramp-all-faders/tracks={tracks}/block=128"),
            |bencher| {
                bencher.iter(|| {
                    gain = if gain < -6.0 { -3.0 } else { -12.0 };
                    for index in 0..tracks {
                        automated
                            .set_channel_gain(index, gain)
                            .expect("gain is in range");
                    }
                    black_box(process_block(&mut automated, &inputs, 128))
                });
            },
        );
    }
    group.finish();
}

fn bench_parameters_and_meters(c: &mut Criterion) {
    let (channels, sends) = scenario(128, 16, 1, Topology::SendHeavy, false);
    let mut graph = MixerGraph::new(48_000, channels, sends).expect("benchmark graph");
    let inputs = vec![[0.25, -0.125]; 128];
    let mut peaks = vec![ChannelPeak::default(); graph.channel_count()];

    let mut group = c.benchmark_group("dsp-core/mixer_graph/parameters_and_meters");
    group
        .warm_up_time(Duration::from_secs(3))
        .measurement_time(Duration::from_secs(5))
        .sample_size(100)
        .noise_threshold(0.03);
    group.bench_function("preview-smooth-and-render/block=256", |bencher| {
        bencher.iter(|| {
            graph.set_channel_gain(0, -18.0).expect("valid gain");
            graph.set_channel_pan(0, 0.75).expect("valid pan");
            black_box(process_block(&mut graph, &inputs, 256))
        });
    });
    group.bench_function("write-and-clear-peaks/channels=145", |bencher| {
        bencher.iter(|| {
            graph.write_peaks(black_box(&mut peaks));
            black_box(&peaks);
        });
    });
    group.finish();
}

criterion_group!(
    benches,
    bench_graph_build,
    bench_process_complexity,
    bench_process_block_api,
    bench_realtime_budget,
    bench_automation,
    bench_block_sizes_and_branches,
    bench_parameters_and_meters
);
criterion_main!(benches);
