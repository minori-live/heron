use super::*;

use heron_vst3_host_sys::Steinberg::Vst;

struct RestartTarget {
    active: bool,
    activation_attempts: usize,
    deactivate_result: i32,
    activate_result: i32,
}

impl RestartTarget {
    fn deactivate(&mut self) -> HostResult<()> {
        // A rejected lifecycle setter may already have changed the plug-in.
        self.active = false;
        check("setActive(false)", self.deactivate_result)
    }

    fn activate(&mut self) -> HostResult<()> {
        assert!(!self.active, "restart must deactivate before activation");
        self.activation_attempts += 1;
        self.active = true;
        check("setActive(true)", self.activate_result)
    }

    fn restart(&mut self) -> HostResult<()> {
        restart_transition(self, Self::deactivate, Self::activate)
    }
}

#[test]
fn rejected_deactivation_keeps_restart_uncertain_and_prevents_activation() {
    let mut target = RestartTarget {
        active: true,
        activation_attempts: 0,
        deactivate_result: 1,
        activate_result: 0,
    };
    assert!(matches!(
        target.restart(),
        Err(HostError::CommitUncertain { source, .. })
        if matches!(*source, HostError::Operation {
            operation: "setActive(false)", result: 1,
        })
    ));
    assert!(!target.active);
    assert_eq!(target.activation_attempts, 0);
}

#[test]
fn failed_activation_is_uncertain_until_an_explicit_restart_establishes_active_state() {
    let mut target = RestartTarget {
        active: true,
        activation_attempts: 0,
        deactivate_result: 0,
        activate_result: 1,
    };
    assert!(matches!(
        target.restart(),
        Err(HostError::CommitUncertain { source, .. })
        if matches!(*source, HostError::Operation {
            operation: "setActive(true)", result: 1,
        })
    ));
    assert!(target.active);
    assert_eq!(target.activation_attempts, 1);

    target.activate_result = 0;
    assert!(target.restart().is_ok());
    assert!(target.active);
    assert_eq!(target.activation_attempts, 2);
}

#[test]
fn audio_layouts_report_their_input_and_output_channel_contracts() {
    assert_eq!(AudioLayout::Mono.input_channels(), 1);
    assert_eq!(AudioLayout::Mono.output_channels(), 1);
    assert_eq!(AudioLayout::MonoToStereo.input_channels(), 1);
    assert_eq!(AudioLayout::MonoToStereo.output_channels(), 2);
    assert_eq!(AudioLayout::Stereo.input_channels(), 2);
    assert_eq!(AudioLayout::Stereo.output_channels(), 2);
}

#[test]
fn midi_note_ids_never_enter_the_plugin_reserved_negative_range() {
    assert_eq!(vst3_note_id(-10_000), -1);
    assert_eq!(vst3_note_id(-2), -1);
    assert_eq!(vst3_note_id(-1), -1);
    assert_eq!(vst3_note_id(0), 0);
    assert_eq!(vst3_note_id(i32::MAX), i32::MAX);
}

#[test]
fn process_context_uses_real_sample_rate_and_only_requested_validity_bits() {
    let mut value = unsafe {
        // SAFETY: ProcessContext is an SDK POD and zero is a valid empty context.
        std::mem::MaybeUninit::<ProcessContext>::zeroed().assume_init()
    };
    let requirements = as_uint32(Vst::IProcessContextRequirements_Flags_kNeedTempo);
    update_process_context(
        &mut value,
        requirements,
        96_000.0,
        &HostProcessContext {
            project_time_samples: 12,
            continuous_time_samples: 13,
            project_time_quarters: 1.0,
            bar_position_quarters: 0.0,
            tempo: 127.0,
            time_signature_numerator: 7,
            time_signature_denominator: 8,
            playing: true,
            recording: true,
        },
    );
    assert_eq!(value.sampleRate, 96_000.0);
    assert_eq!(
        value.state,
        as_uint32(Vst::ProcessContext_StatesAndFlags_kTempoValid)
    );
    assert_eq!(value.tempo, 127.0);
}

#[test]
fn multi_output_storage_keeps_every_bus_and_channel_pointer_valid() {
    let storage = build_audio_bus_storage(&[2; 18], false);

    assert_eq!(storage.descriptors.len(), 18);
    assert_eq!(storage.channel_pointers.len(), 18);
    assert_eq!(storage.scratch.len(), 18);
    for (descriptor, pointers) in storage.descriptors.iter().zip(&storage.channel_pointers) {
        assert_eq!(descriptor.numChannels, 2);
        assert_eq!(pointers.len(), 2);
        // SAFETY: the storage builder initialized the active sample32 union member.
        assert!(!unsafe { descriptor.__bindgen_anon_1.channelBuffers32 }.is_null());
        assert!(pointers.iter().all(|pointer| !pointer.is_null()));
    }
}

#[test]
fn inactive_input_storage_reports_silent_channels() {
    let storage = build_audio_bus_storage(&[1, 2, 64], true);

    assert_eq!(storage.descriptors[0].silenceFlags, 0b1);
    assert_eq!(storage.descriptors[1].silenceFlags, 0b11);
    assert_eq!(storage.descriptors[2].silenceFlags, u64::MAX);
}

#[test]
fn auxiliary_inputs_connect_mono_and_stereo_buffers_then_restore_scratch() {
    let mut storage = build_audio_bus_storage(&[2, 1, 2], true);
    let mono = AuxiliaryAudioInput {
        bus_index: 1,
        channels: 1,
        left: vec![0.25; 8],
        right: Vec::new(),
    };
    let stereo = AuxiliaryAudioInput {
        bus_index: 2,
        channels: 2,
        left: vec![0.5; 8],
        right: vec![0.75; 8],
    };

    storage.connect_aux(&mono, 8).unwrap();
    storage.connect_aux(&stereo, 8).unwrap();

    assert_eq!(storage.descriptors[1].silenceFlags, 0);
    assert_eq!(storage.descriptors[2].silenceFlags, 0);
    assert_eq!(
        storage.channel_pointers[1],
        vec![mono.left.as_ptr().cast_mut()]
    );
    assert_eq!(
        storage.channel_pointers[2],
        vec![
            stereo.left.as_ptr().cast_mut(),
            stereo.right.as_ptr().cast_mut()
        ]
    );

    storage.disconnect_bus(1);
    storage.disconnect_bus(2);

    assert_eq!(storage.descriptors[1].silenceFlags, 0b1);
    assert_eq!(storage.descriptors[2].silenceFlags, 0b11);
    assert_eq!(
        storage.channel_pointers[1][0],
        storage.scratch[1].as_mut_ptr()
    );
    assert_eq!(
        storage.channel_pointers[2][0],
        storage.scratch[2].as_mut_ptr()
    );
    assert_eq!(
        storage.channel_pointers[2][1],
        // SAFETY: the stereo bus scratch allocation reserves one full maximum-size block
        // for each of its two channels.
        unsafe {
            storage.scratch[2]
                .as_mut_ptr()
                .add(MAX_BLOCK_FRAMES as usize)
        }
    );
}

#[test]
fn auxiliary_input_connection_rejects_invalid_bus_storage_and_block_shapes() {
    let mono = AuxiliaryAudioInput {
        bus_index: 1,
        channels: 1,
        left: vec![0.25; 8],
        right: Vec::new(),
    };
    let invalid_bus = AuxiliaryAudioInput {
        bus_index: 9,
        ..mono.clone()
    };
    let wrong_channels = AuxiliaryAudioInput {
        channels: 2,
        right: vec![0.5; 8],
        ..mono.clone()
    };
    let short_left = AuxiliaryAudioInput {
        left: vec![0.25; 7],
        ..mono.clone()
    };
    let short_right = AuxiliaryAudioInput {
        bus_index: 2,
        channels: 2,
        right: vec![0.5; 7],
        ..mono.clone()
    };

    let mut storage = build_audio_bus_storage(&[2, 1, 2], true);
    for input in [&invalid_bus, &wrong_channels, &short_left, &short_right] {
        assert!(matches!(
            storage.connect_aux(input, 8),
            Err(HostError::InvalidArgument { .. })
        ));
    }

    storage.channel_pointers.pop();
    storage.channel_pointers.pop();
    assert!(matches!(
        storage.connect_aux(&mono, 8),
        Err(HostError::InvalidArgument {
            operation: "aux audio input bus storage",
        })
    ));

    storage.disconnect_bus(99);
}

#[test]
fn silence_masks_cover_empty_regular_and_wide_buses() {
    assert_eq!(silence_flags(0), 0);
    assert_eq!(silence_flags(1), 0b1);
    assert_eq!(silence_flags(8), 0xff);
    assert_eq!(silence_flags(63), i64::MAX as u64);
    assert_eq!(silence_flags(64), u64::MAX);
    assert_eq!(silence_flags(128), u64::MAX);
}

#[test]
fn main_bus_connections_swap_caller_buffers_for_owned_scratch() {
    let mut input = build_audio_bus_storage(&[2], true);
    let mut left = vec![0.25_f32; 8];
    let mut right = vec![0.5_f32; 8];
    let mut pointers = [left.as_mut_ptr(), right.as_mut_ptr()];

    input.connect_main(&mut pointers);
    assert_eq!(input.channel_pointers[0], pointers);
    assert_eq!(input.descriptors[0].silenceFlags, 0);
    input.disconnect_main();
    assert_ne!(input.channel_pointers[0], pointers);
    assert_eq!(input.descriptors[0].silenceFlags, 0b11);

    let mut output = build_audio_bus_storage(&[1], false);
    let mut channel = vec![0.75_f32; 8];
    output.connect_main(&mut [channel.as_mut_ptr()]);
    output.disconnect_main();
    assert_eq!(output.descriptors[0].silenceFlags, 0);
}

#[test]
fn main_bus_validation_distinguishes_effect_and_instrument_inputs() {
    let mono_input = build_audio_bus_storage(&[1], true);
    let stereo_input = build_audio_bus_storage(&[2], true);
    let mono_output = build_audio_bus_storage(&[1], false);
    let stereo_output = build_audio_bus_storage(&[2], false);
    let no_input = AudioBusStorage::empty(true);
    let no_output = AudioBusStorage::empty(false);

    assert!(
        validate_main_bus_layout(
            &mono_input,
            &mono_output,
            PluginKind::Effect,
            AudioLayout::Mono,
        )
        .is_ok()
    );
    assert!(
        validate_main_bus_layout(
            &mono_input,
            &stereo_output,
            PluginKind::Effect,
            AudioLayout::MonoToStereo,
        )
        .is_ok()
    );
    assert!(
        validate_main_bus_layout(
            &stereo_input,
            &stereo_output,
            PluginKind::Effect,
            AudioLayout::Stereo,
        )
        .is_ok()
    );
    assert!(
        validate_main_bus_layout(
            &no_input,
            &stereo_output,
            PluginKind::Instrument,
            AudioLayout::Stereo,
        )
        .is_ok()
    );
    assert!(matches!(
        validate_main_bus_layout(
            &mono_input,
            &stereo_output,
            PluginKind::Effect,
            AudioLayout::Stereo,
        ),
        Err(HostError::InvalidArgument {
            operation: "main audio input layout",
            ..
        })
    ));
    assert!(matches!(
        validate_main_bus_layout(
            &mono_input,
            &no_output,
            PluginKind::Effect,
            AudioLayout::Mono,
        ),
        Err(HostError::InvalidArgument {
            operation: "main audio output layout",
            ..
        })
    ));
}

#[test]
fn full_process_context_maps_transport_and_timeline_fields() {
    let requirements = legacy_process_context_requirements();
    let expected_state = supported_process_context_state(requirements);
    let mut value = unsafe {
        // SAFETY: ProcessContext is an SDK POD and zero is a valid empty context.
        std::mem::MaybeUninit::<ProcessContext>::zeroed().assume_init()
    };
    let context = HostProcessContext {
        project_time_samples: 11,
        continuous_time_samples: 12,
        project_time_quarters: 3.5,
        bar_position_quarters: 2.0,
        tempo: 99.0,
        time_signature_numerator: 5,
        time_signature_denominator: 4,
        playing: true,
        recording: true,
    };
    update_process_context(&mut value, requirements, 44_100.0, &context);

    assert_eq!(value.state & expected_state, expected_state);
    assert_ne!(
        value.state & as_uint32(Vst::ProcessContext_StatesAndFlags_kPlaying),
        0
    );
    assert_ne!(
        value.state & as_uint32(Vst::ProcessContext_StatesAndFlags_kRecording),
        0
    );
    assert_eq!(value.projectTimeSamples, 11);
    assert_eq!(value.continousTimeSamples, 12);
    assert_eq!(value.projectTimeMusic, 3.5);
    assert_eq!(value.barPositionMusic, 2.0);
    assert_eq!(value.timeSigNumerator, 5);
    assert_eq!(value.timeSigDenominator, 4);

    let stopped = HostProcessContext {
        playing: false,
        recording: false,
        ..context
    };
    update_process_context(&mut value, requirements, 44_100.0, &stopped);
    assert_eq!(
        value.state & as_uint32(Vst::ProcessContext_StatesAndFlags_kPlaying),
        0
    );
    assert_eq!(
        value.state & as_uint32(Vst::ProcessContext_StatesAndFlags_kRecording),
        0
    );
}

#[test]
fn empty_bus_storage_has_a_null_sdk_channel_array() {
    let storage = build_audio_bus_storage(&[0], true);
    assert_eq!(storage.descriptors[0].numChannels, 0);
    assert!(storage.channel_pointers[0].is_empty());
    // SAFETY: the storage builder initializes the sample32 union member.
    assert!(unsafe { storage.descriptors[0].__bindgen_anon_1.channelBuffers32 }.is_null());
}

#[test]
fn arrangement_refusal_adopts_a_consistent_auxiliary_counter_offer() {
    use super::buses::{negotiate_and_verify_arrangements, read_negotiated_arrangements};
    use std::cell::RefCell;

    let outputs = RefCell::new(vec![
        (Vst::SpeakerArr::kStereo, 2),
        (Vst::SpeakerArr::kStereo, 2),
    ]);
    let proposed = RefCell::new(Vec::new());
    let result = negotiate_and_verify_arrangements(
        vec![Vst::SpeakerArr::kStereo],
        vec![Vst::SpeakerArr::kStereo; 2],
        |inputs, requested_outputs| {
            assert_eq!(inputs, [Vst::SpeakerArr::kStereo]);
            proposed.borrow_mut().push(requested_outputs.to_vec());
            outputs.borrow_mut()[1] = (Vst::SpeakerArr::kMono, 1);
            1
        },
        || {
            read_negotiated_arrangements(
                1,
                2,
                |direction| {
                    if direction == Vst::BusDirections_kInput {
                        1
                    } else {
                        outputs.borrow().len() as i32
                    }
                },
                |direction, index| {
                    Ok(if direction == Vst::BusDirections_kInput {
                        (Vst::SpeakerArr::kStereo, 2)
                    } else {
                        outputs.borrow()[index as usize]
                    })
                },
            )
        },
    );

    assert!(result.is_ok());
    assert_eq!(
        *proposed.borrow(),
        vec![
            vec![Vst::SpeakerArr::kStereo, Vst::SpeakerArr::kStereo],
            vec![Vst::SpeakerArr::kStereo, Vst::SpeakerArr::kMono],
        ]
    );
}

#[test]
fn second_arrangement_refusal_cannot_hide_an_inconsistent_actual_auxiliary_bus() {
    use super::buses::{negotiate_and_verify_arrangements, read_negotiated_arrangements};
    use std::cell::RefCell;

    let auxiliary = RefCell::new((Vst::SpeakerArr::kStereo, 2));
    let proposals = RefCell::new(0);
    let result = negotiate_and_verify_arrangements(
        vec![Vst::SpeakerArr::kStereo],
        vec![Vst::SpeakerArr::kStereo; 2],
        |_, _| {
            *proposals.borrow_mut() += 1;
            // The first rejection offers mono. The confirmation then corrupts
            // only the auxiliary channel count, while the main bus stays valid.
            *auxiliary.borrow_mut() = (
                Vst::SpeakerArr::kMono,
                if *proposals.borrow() == 1 { 1 } else { 2 },
            );
            1
        },
        || {
            read_negotiated_arrangements(
                1,
                2,
                |direction| {
                    if direction == Vst::BusDirections_kInput {
                        1
                    } else {
                        2
                    }
                },
                |direction, index| {
                    Ok(if direction == Vst::BusDirections_kOutput && index == 1 {
                        *auxiliary.borrow()
                    } else {
                        (Vst::SpeakerArr::kStereo, 2)
                    })
                },
            )
        },
    );

    assert!(matches!(result, Err(HostError::InvalidArgument { .. })));
    assert_eq!(*proposals.borrow(), 2);
}

#[test]
fn accepted_arrangement_still_requires_unchanged_bus_counts_and_consistent_information() {
    use super::buses::{negotiate_and_verify_arrangements, read_negotiated_arrangements};

    let changed_count = negotiate_and_verify_arrangements(
        Vec::new(),
        vec![Vst::SpeakerArr::kStereo],
        |_, _| 0,
        || {
            read_negotiated_arrangements(
                0,
                1,
                |direction| {
                    if direction == Vst::BusDirections_kInput {
                        0
                    } else {
                        2
                    }
                },
                |_, _| Ok((Vst::SpeakerArr::kStereo, 2)),
            )
        },
    );
    assert!(matches!(
        changed_count,
        Err(HostError::InvalidArgument { .. })
    ));

    let inconsistent = negotiate_and_verify_arrangements(
        Vec::new(),
        vec![Vst::SpeakerArr::kStereo],
        |_, _| 0,
        || {
            read_negotiated_arrangements(
                0,
                1,
                |direction| {
                    if direction == Vst::BusDirections_kInput {
                        0
                    } else {
                        1
                    }
                },
                |_, _| Ok((Vst::SpeakerArr::kStereo, 1)),
            )
        },
    );
    assert!(matches!(
        inconsistent,
        Err(HostError::InvalidArgument { .. })
    ));
}
