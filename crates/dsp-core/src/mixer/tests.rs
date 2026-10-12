use super::{
    ChannelKind, ChannelSpec, GraphError, MixerGraph, RouteTarget, SendSpec, SendTap,
    balance_stereo, pan_mono,
};

fn channel(id: &str, kind: ChannelKind, output: Option<usize>) -> ChannelSpec {
    ChannelSpec {
        id: id.to_owned(),
        kind,
        gain_db: 0.0,
        pan: 0.0,
        muted: false,
        soloed: false,
        output: output.map(RouteTarget::Output),
        input_bus: (kind == ChannelKind::Aux).then_some([0, 0]),
        hardware_output: (kind == ChannelKind::Output).then_some([0, 1]),
    }
}

fn rendered(graph: &mut MixerGraph, inputs: &[super::StereoFrame]) -> super::StereoFrame {
    let output = graph.process_frame(inputs);
    [output[0], output[1]]
}

#[test]
fn mono_pan_is_equal_power() {
    let center = pan_mono(1.0, 0.0);
    assert!((center[0] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1.0e-6);
    assert!((center[1] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1.0e-6);
    assert_eq!(pan_mono(1.0, -1.0), [1.0, 0.0]);
}

#[test]
fn stereo_pan_behaves_as_balance() {
    assert_eq!(balance_stereo([0.25, 0.5], -1.0), [0.25, 0.0]);
    assert_eq!(balance_stereo([0.25, 0.5], 1.0), [0.0, 0.5]);
}

#[test]
fn renders_independent_stereo_pairs_to_multiple_hardware_outputs() {
    let mut second_output = channel("headphones", ChannelKind::Output, None);
    second_output.hardware_output = Some([2, 3]);
    let channels = vec![
        channel("speakers-track", ChannelKind::Audio, Some(3)),
        channel("headphones-track", ChannelKind::Audio, Some(4)),
        channel("master", ChannelKind::Master, None),
        channel("speakers", ChannelKind::Output, None),
        second_output,
    ];
    let mut graph = MixerGraph::new(48_000, channels, vec![]).unwrap();

    let output = graph.process_frame(&[[0.25, 0.5], [0.75, 1.0]]);

    assert_eq!(&output[..4], &[0.25, 0.5, 0.75, 1.0]);
}

#[test]
fn master_is_an_unrouted_global_output_control() {
    let mut master = channel("master", ChannelKind::Master, None);
    master.muted = true;
    let channels = vec![
        channel("audio", ChannelKind::Audio, Some(2)),
        master,
        channel("speakers", ChannelKind::Output, None),
    ];
    let mut graph = MixerGraph::new(48_000, channels, vec![]).unwrap();

    assert_eq!(rendered(&mut graph, &[[1.0, 0.5]]), [0.0, 0.0]);

    let invalid_channels = vec![
        channel("audio", ChannelKind::Audio, Some(1)),
        channel("master", ChannelKind::Master, None),
        channel("speakers", ChannelKind::Output, None),
    ];
    assert!(matches!(
        MixerGraph::new(48_000, invalid_channels, vec![]),
        Err(GraphError::InvalidOutput)
    ));
}

#[test]
fn rejects_output_and_send_cycles() {
    let channels = vec![
        channel("aux-a", ChannelKind::Aux, Some(3)),
        channel("aux-b", ChannelKind::Aux, Some(3)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let sends = vec![
        SendSpec {
            id: "a-to-b".to_owned(),
            source: 0,
            target: RouteTarget::Bus(1),
            enabled: true,
            tap: SendTap::Post,
            level_db: 0.0,
        },
        SendSpec {
            id: "b-to-a".to_owned(),
            source: 1,
            target: RouteTarget::Bus(0),
            enabled: true,
            tap: SendTap::Post,
            level_db: 0.0,
        },
    ];
    let mut channels = channels;
    channels[0].input_bus = Some([0, 0]);
    channels[1].input_bus = Some([1, 1]);
    assert!(matches!(
        MixerGraph::new(48_000, channels, sends),
        Err(GraphError::RoutingCycle)
    ));
}

#[test]
fn pre_send_bypasses_source_fader_and_mute() {
    let mut source = channel("audio", ChannelKind::Audio, Some(3));
    source.gain_db = -90.0;
    source.muted = true;
    let channels = vec![
        source,
        channel("aux", ChannelKind::Aux, Some(3)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let sends = vec![SendSpec {
        id: "send".to_owned(),
        source: 0,
        target: RouteTarget::Bus(0),
        enabled: true,
        tap: SendTap::Pre,
        level_db: 0.0,
    }];
    let mut graph = MixerGraph::new(48_000, channels, sends).unwrap();
    let output = rendered(&mut graph, &[[1.0, 1.0]]);
    assert_eq!(output, [1.0, 1.0]);
}

#[test]
fn post_send_follows_source_mute() {
    let mut source = channel("audio", ChannelKind::Audio, Some(3));
    source.muted = true;
    let channels = vec![
        source,
        channel("aux", ChannelKind::Aux, Some(3)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let sends = vec![SendSpec {
        id: "send".to_owned(),
        source: 0,
        target: RouteTarget::Bus(0),
        enabled: true,
        tap: SendTap::Post,
        level_db: 0.0,
    }];
    let mut graph = MixerGraph::new(48_000, channels, sends).unwrap();
    assert_eq!(rendered(&mut graph, &[[1.0, 1.0]]), [0.0, 0.0]);
}

#[test]
fn stereo_aux_reads_two_adjacent_mono_bus_slots() {
    let mut left_source = channel("left", ChannelKind::Audio, Some(4));
    left_source.muted = true;
    let mut right_source = channel("right", ChannelKind::Audio, Some(4));
    right_source.muted = true;
    let mut aux = channel("aux", ChannelKind::Aux, Some(4));
    aux.input_bus = Some([0, 1]);
    let channels = vec![
        left_source,
        right_source,
        aux,
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let sends = vec![
        SendSpec {
            id: "left-send".to_owned(),
            source: 0,
            target: RouteTarget::Bus(0),
            enabled: true,
            tap: SendTap::Pre,
            level_db: 0.0,
        },
        SendSpec {
            id: "right-send".to_owned(),
            source: 1,
            target: RouteTarget::Bus(1),
            enabled: true,
            tap: SendTap::Pre,
            level_db: 0.0,
        },
    ];
    let mut graph = MixerGraph::new(48_000, channels, sends).unwrap();

    assert_eq!(rendered(&mut graph, &[[1.0, 0.0], [0.0, 2.0]]), [0.5, 1.0]);
}

#[test]
fn main_outputs_can_target_buses_and_sends_can_target_outputs() {
    let mut bus_source = channel("bus-source", ChannelKind::Audio, None);
    bus_source.output = Some(RouteTarget::Bus(0));
    let mut output_send_source = channel("output-send-source", ChannelKind::Audio, None);
    output_send_source.output = Some(RouteTarget::Bus(2));
    let channels = vec![
        bus_source,
        output_send_source,
        channel("aux", ChannelKind::Aux, Some(4)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let sends = vec![SendSpec {
        id: "output-send".to_owned(),
        source: 1,
        target: RouteTarget::Output(4),
        enabled: true,
        tap: SendTap::PostPan,
        level_db: 0.0,
    }];
    let mut graph = MixerGraph::new(48_000, channels, sends).unwrap();

    assert_eq!(rendered(&mut graph, &[[1.0, 1.0], [0.5, 1.0]]), [1.5, 2.0]);
}

#[test]
fn post_pan_send_follows_source_pan_after_the_fader() {
    let mut source = channel("audio", ChannelKind::Audio, Some(3));
    source.pan = 1.0;
    let channels = vec![
        source,
        channel("aux", ChannelKind::Aux, Some(3)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let sends = vec![SendSpec {
        id: "send".to_owned(),
        source: 0,
        target: RouteTarget::Bus(0),
        enabled: true,
        tap: SendTap::PostPan,
        level_db: 0.0,
    }];
    let mut graph = MixerGraph::new(48_000, channels, sends).unwrap();
    assert_eq!(rendered(&mut graph, &[[1.0, 1.0]]), [0.5, 1.5]);
}

#[test]
fn solo_keeps_only_participating_route_edges_and_mute_wins() {
    let mut soloed = channel("soloed", ChannelKind::Audio, Some(4));
    soloed.soloed = true;
    let channels = vec![
        soloed,
        channel("other", ChannelKind::Audio, Some(4)),
        channel("aux", ChannelKind::Aux, Some(4)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let mut graph = MixerGraph::new(48_000, channels, vec![]).unwrap();
    assert_eq!(
        rendered(&mut graph, &[[0.25, 0.25], [0.75, 0.75]]),
        [0.25, 0.25]
    );

    let mut source = channel("source", ChannelKind::Audio, Some(3));
    source.muted = true;
    source.soloed = true;
    let channels = vec![
        source,
        channel("other", ChannelKind::Audio, Some(3)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let mut graph = MixerGraph::new(48_000, channels, vec![]).unwrap();
    assert_eq!(rendered(&mut graph, &[[1.0, 1.0], [1.0, 1.0]]), [0.0, 0.0]);
}

#[test]
fn soloed_aux_receives_bus_inputs_without_leaking_direct_outputs() {
    let source = channel("source", ChannelKind::Audio, Some(3));
    let mut aux = channel("aux", ChannelKind::Aux, Some(3));
    aux.soloed = true;
    let channels = vec![
        source,
        aux,
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let sends = vec![SendSpec {
        id: "send".to_owned(),
        source: 0,
        target: RouteTarget::Bus(0),
        enabled: true,
        tap: SendTap::Post,
        level_db: 0.0,
    }];
    let mut graph = MixerGraph::new(48_000, channels, sends).unwrap();
    assert_eq!(rendered(&mut graph, &[[0.5, 0.5]]), [0.5, 0.5]);
}

#[test]
fn parameter_changes_are_smoothed_and_meters_reset_after_snapshot() {
    let channels = vec![
        channel("audio", ChannelKind::Audio, Some(2)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let mut graph = MixerGraph::new(1_000, channels, vec![]).unwrap();
    graph.set_channel_gain(0, -90.0).unwrap();
    let first = rendered(&mut graph, &[[1.0, 0.5]]);
    assert!(first[0] > 0.0 && first[0] < 1.0);
    for _ in 0..200 {
        graph.process_frame(&[[1.0, 0.5]]);
    }
    assert!(rendered(&mut graph, &[[1.0, 0.5]])[0] < 1.0e-6);

    let mut peaks = vec![Default::default(); graph.channel_count()];
    graph.write_peaks(&mut peaks);
    assert_eq!(peaks[0].pre, [1.0, 0.5]);
    graph.write_peaks(&mut peaks);
    assert_eq!(peaks[0].pre, [0.0, 0.0]);
}

#[test]
fn block_processing_matches_frame_processing_and_visits_each_channel_once() {
    let channels = vec![
        channel("audio", ChannelKind::Audio, Some(2)),
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let mut frame_graph = MixerGraph::new(48_000, channels.clone(), vec![]).unwrap();
    let mut block_graph = MixerGraph::new(48_000, channels, vec![]).unwrap();
    block_graph.prepare_block_processing(4);
    let inputs = [[0.25, -0.5], [0.5, -0.25], [0.75, 0.0], [1.0, 0.25]];
    let mut expected = [[0.0; super::MAX_OUTPUT_CHANNELS]; 4];
    for (target, input) in expected.iter_mut().zip(inputs) {
        *target = frame_graph.process_frame_with_sources(
            &[input, [0.0; 2], [0.0; 2]],
            &mut |_, mut frame| {
                frame[0] *= 0.5;
                frame[1] *= 0.5;
                frame
            },
        );
    }

    let mut sources = vec![[0.0; 2]; block_graph.channel_count() * inputs.len()];
    sources[..inputs.len()].copy_from_slice(&inputs);
    let mut actual = [[0.0; super::MAX_OUTPUT_CHANNELS]; 4];
    let mut channel_visits = 0;
    block_graph
        .process_block_with_sources(&mut sources, &mut actual, &mut |_, frames, _| {
            channel_visits += 1;
            for frame in frames {
                frame[0] *= 0.5;
                frame[1] *= 0.5;
            }
        })
        .unwrap();

    assert_eq!(actual, expected);
    assert_eq!(channel_visits, block_graph.channel_count() - 1);
}

#[test]
fn stereo_bus_routes_preserve_left_and_right_in_frames_and_blocks() {
    for tap in [
        None,
        Some(SendTap::Pre),
        Some(SendTap::Post),
        Some(SendTap::PostPan),
    ] {
        let mut source = channel("source", ChannelKind::Audio, Some(3));
        source.output = Some(if tap.is_none() {
            RouteTarget::StereoBus(0)
        } else {
            RouteTarget::Bus(9)
        });
        let mut receiver = channel("receiver", ChannelKind::Aux, Some(3));
        receiver.input_bus = Some([0, 1]);
        let channels = vec![
            source,
            receiver,
            channel("master", ChannelKind::Master, None),
            channel("output", ChannelKind::Output, None),
        ];
        let sends = tap
            .map(|tap| SendSpec {
                id: "stereo".into(),
                source: 0,
                target: RouteTarget::StereoBus(0),
                enabled: true,
                tap,
                level_db: 0.0,
            })
            .into_iter()
            .collect::<Vec<_>>();
        let mut frames = MixerGraph::new(48_000, channels.clone(), sends.clone()).unwrap();
        assert_eq!(rendered(&mut frames, &[[0.25, -0.75]]), [0.25, -0.75]);
        let mut blocks = MixerGraph::new(48_000, channels, sends).unwrap();
        blocks.prepare_block_processing(2);
        let mut sources = vec![[0.0; 2]; 8];
        sources[0] = [0.25, -0.75];
        sources[1] = [-0.5, 1.0];
        let mut output = [[0.0; super::MAX_OUTPUT_CHANNELS]; 2];
        blocks
            .process_block_with_sources(&mut sources, &mut output, &mut |_, _, _| {})
            .unwrap();
        assert_eq!(&output[0][..2], &[0.25, -0.75]);
        assert_eq!(&output[1][..2], &[-0.5, 1.0]);
    }
}

#[test]
fn stereo_bus_right_side_participates_in_feedback_and_solo() {
    let mut source = channel("source", ChannelKind::Audio, Some(3));
    source.output = Some(RouteTarget::StereoBus(0));
    let mut receiver = channel("right", ChannelKind::Aux, Some(3));
    receiver.input_bus = Some([1, 1]);
    let channels = vec![
        source,
        receiver,
        channel("master", ChannelKind::Master, None),
        channel("output", ChannelKind::Output, None),
    ];
    let mut graph = MixerGraph::new(48_000, channels.clone(), vec![]).unwrap();
    graph.set_channel_soloed(1, true).unwrap();
    assert_eq!(rendered(&mut graph, &[[0.25, -0.75]]), [-0.75, -0.75]);
    let mut cyclic = channels.clone();
    cyclic[1].output = Some(RouteTarget::StereoBus(0));
    assert!(matches!(
        MixerGraph::new(48_000, cyclic, vec![]),
        Err(GraphError::RoutingCycle)
    ));
    let mut invalid = channels;
    invalid[0].output = Some(RouteTarget::StereoBus(255));
    assert!(matches!(
        MixerGraph::new(48_000, invalid, vec![]),
        Err(GraphError::InvalidOutput)
    ));
}

#[test]
fn mono_output_routes_downmix_frames_and_blocks_before_the_output_strip() {
    for tap in [
        None,
        Some(SendTap::Pre),
        Some(SendTap::Post),
        Some(SendTap::PostPan),
    ] {
        let mut source = channel("source", ChannelKind::Audio, Some(2));
        source.output = Some(if tap.is_none() {
            RouteTarget::MonoOutput(2)
        } else {
            RouteTarget::Bus(9)
        });
        let channels = vec![
            source,
            channel("master", ChannelKind::Master, None),
            channel("output", ChannelKind::Output, None),
        ];
        let sends = tap
            .map(|tap| SendSpec {
                id: "mono".into(),
                source: 0,
                target: RouteTarget::MonoOutput(2),
                enabled: true,
                tap,
                level_db: 0.0,
            })
            .into_iter()
            .collect::<Vec<_>>();
        let mut frames = MixerGraph::new(48_000, channels.clone(), sends.clone()).unwrap();
        assert_eq!(rendered(&mut frames, &[[0.25, -0.75]]), [-0.25, -0.25]);
        let mut blocks = MixerGraph::new(48_000, channels, sends).unwrap();
        blocks.prepare_block_processing(2);
        let mut sources = vec![[0.0; 2]; 6];
        sources[0] = [0.25, -0.75];
        sources[1] = [-0.5, 1.0];
        let mut output = [[0.0; super::MAX_OUTPUT_CHANNELS]; 2];
        blocks
            .process_block_with_sources(&mut sources, &mut output, &mut |_, _, _| {})
            .unwrap();
        assert_eq!(&output[0][..2], &[-0.25, -0.25]);
        assert_eq!(&output[1][..2], &[0.25, 0.25]);
    }
}
