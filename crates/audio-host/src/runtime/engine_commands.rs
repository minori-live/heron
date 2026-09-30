use super::{
    AudioBackend, ControlCommand, ControlResult, MIDI_INPUT, MixerChannelMeter,
    RecordingStartConfig, TransportState, device, engine,
};

fn audition_control_result<E: std::fmt::Display>(
    result: std::result::Result<(), E>,
) -> ControlResult {
    match result {
        Ok(()) => ControlResult::Accepted,
        Err(error) => control_error! {
            message: error.to_string(),
        },
    }
}

pub(super) fn engine_command(
    audio_engine: &engine::AudioEngine,
    command: ControlCommand,
) -> Option<ControlResult> {
    let result = match command {
        ControlCommand::ListAudioBackends => ControlResult::AudioBackends {
            backends: device::list_audio_backends()
                .into_iter()
                .map(|backend| AudioBackend {
                    id: backend.id,
                    label: backend.label,
                    available: backend.available,
                })
                .collect(),
        },
        ControlCommand::ListAudioDevices { backend } => {
            let value = match device::list_audio_devices(backend) {
                Ok(value) => value,
                Err(error) => {
                    return Some(control_error! {
                        message: error.to_string(),
                    });
                }
            };
            ControlResult::AudioDevices { devices: value }
        }
        ControlCommand::ListApplicationCaptureTargets => ControlResult::ApplicationCaptureTargets {
            targets: audio_engine
                .list_application_capture_targets()
                .into_iter()
                .collect(),
        },
        ControlCommand::ApplicationCaptureSnapshot => ControlResult::ApplicationCaptures {
            captures: audio_engine
                .application_capture_snapshot()
                .into_iter()
                .collect(),
        },
        ControlCommand::StartAudioEngine { config } => {
            match audio_engine.start_audio_engine(engine::AudioEngineConfig {
                backend: config.backend,
                input_device_id: config.input_device_id,
                output_device_id: config.output_device_id,
                buffer_size: config.buffer_size,
                session_sample_rate: config.session_sample_rate,
            }) {
                Ok(runtime) => ControlResult::AudioRuntime { runtime },
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::StopAudioEngine => match audio_engine.stop_audio_engine() {
            Ok(runtime) => ControlResult::AudioRuntime { runtime },
            Err(error) => control_error! {
                message: error.to_string(),
            },
        },
        ControlCommand::AudioEngineSnapshot => match audio_engine.audio_engine_snapshot() {
            Ok(runtime) => ControlResult::AudioRuntime { runtime },
            Err(error) => control_error! {
                message: error.to_string(),
            },
        },
        ControlCommand::AuthorizeDeviceRecovery { recovery_id } => {
            match audio_engine.authorize_device_recovery(recovery_id) {
                Ok(()) => ControlResult::AudioDeviceRecovery {
                    recovery: audio_engine.device_recovery_snapshot(),
                    runtime: None,
                },
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::SelectDeviceRecovery {
            recovery_id,
            config,
        } => match audio_engine.select_recovery_device(recovery_id, config) {
            Ok(runtime) => ControlResult::AudioDeviceRecovery {
                recovery: audio_engine.device_recovery_snapshot(),
                runtime: Some(runtime),
            },
            Err(error) => control_error! {
                message: error.to_string(),
            },
        },
        ControlCommand::KeepRestoredDevice { recovery_id } => {
            match audio_engine.keep_restored_device(recovery_id) {
                Ok(()) => ControlResult::AudioDeviceRecovery {
                    recovery: None,
                    runtime: audio_engine.audio_engine_snapshot().ok(),
                },
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::DeviceRecoverySnapshot => ControlResult::AudioDeviceRecovery {
            recovery: audio_engine.device_recovery_snapshot(),
            runtime: audio_engine.audio_engine_snapshot().ok(),
        },
        ControlCommand::StartRoundTripLatencyMeasurement { request } => {
            match audio_engine.start_round_trip_latency_measurement(
                engine::RoundTripLatencyMeasurementRequest {
                    input_channel: request.input_channel,
                    output_channel: request.output_channel,
                },
            ) {
                Ok(measurement) => ControlResult::RoundTripLatencyMeasurement { measurement },
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::RoundTripLatencyMeasurementSnapshot => {
            match audio_engine.round_trip_latency_measurement_snapshot() {
                Ok(measurement) => ControlResult::RoundTripLatencyMeasurement { measurement },
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::PreviewMixerParameter { preview } => {
            match audio_engine.preview_mixer_parameter(engine::MixerParameterPreview {
                target: preview.target,
                id: preview.id,
                parameter: preview.parameter,
                value: preview.value,
            }) {
                Ok(()) => ControlResult::Accepted,
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::StartAssetAudition {
            path,
            hardware_outputs,
        } => audition_control_result(audio_engine.start_asset_audition(&path, hardware_outputs)),
        ControlCommand::StopAssetAudition => {
            audition_control_result(audio_engine.stop_asset_audition())
        }
        ControlCommand::MixerSnapshot => match audio_engine.mixer_snapshot() {
            Ok(snapshot) => ControlResult::MixerSnapshot {
                meters: snapshot
                    .meters
                    .into_iter()
                    .map(|meter| MixerChannelMeter {
                        channel_id: meter.channel_id,
                        pre_left: meter.pre_left,
                        pre_right: meter.pre_right,
                        post_left: meter.post_left,
                        post_right: meter.post_right,
                        held_left: meter.held_left,
                        held_right: meter.held_right,
                        clipped: meter.clipped,
                    })
                    .collect(),
            },
            Err(error) => control_error! {
                message: error.to_string(),
            },
        },
        ControlCommand::CompiledGraphSnapshot => ControlResult::CompiledGraphSnapshot {
            snapshot: audio_engine.compiled_audio_graph_snapshot(),
        },
        ControlCommand::ClearMeterClips => {
            match audio_engine.transport_command(
                "clear-meter-clips".to_owned(),
                None,
                None,
                None,
                None,
            ) {
                Ok(_) => ControlResult::Accepted,
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::Transport { command } => {
            match audio_engine.transport_command(
                command.kind,
                command.position_frames,
                command.loop_enabled,
                command.loop_start_tick,
                command.loop_end_tick,
            ) {
                Ok(value) => ControlResult::TransportSnapshot {
                    transport: TransportState {
                        state: value.state,
                        position_frames: value.position_frames,
                        position_ticks: value.position_ticks,
                        sample_rate: value.sample_rate,
                        effective_bpm: value.effective_bpm,
                        clock_source: value.clock_source,
                        waiting_for: value.waiting_for,
                        loop_enabled: value.loop_enabled,
                        loop_start_tick: value.loop_start_tick,
                        loop_end_tick: value.loop_end_tick,
                    },
                },
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::TransportSnapshot => match audio_engine.transport_snapshot() {
            Ok(value) => ControlResult::TransportSnapshot {
                transport: TransportState {
                    state: value.state,
                    position_frames: value.position_frames,
                    position_ticks: value.position_ticks,
                    sample_rate: value.sample_rate,
                    effective_bpm: value.effective_bpm,
                    clock_source: value.clock_source,
                    waiting_for: value.waiting_for,
                    loop_enabled: value.loop_enabled,
                    loop_start_tick: value.loop_start_tick,
                    loop_end_tick: value.loop_end_tick,
                },
            },
            Err(error) => control_error! {
                message: error.to_string(),
            },
        },
        ControlCommand::MidiInputSnapshot => match MIDI_INPUT.get() {
            Some(actor) => ControlResult::MidiInputSnapshot {
                midi_input: actor.snapshot(),
            },
            None => control_error! {
                message: "MIDI input actor is unavailable".to_owned(),
            },
        },
        ControlCommand::ConfigureMidiInput { preferences } => {
            match MIDI_INPUT
                .get()
                .ok_or_else(|| "MIDI input actor is unavailable".to_owned())
                .and_then(|actor| actor.configure(preferences))
            {
                Ok(midi_input) => ControlResult::MidiInputSnapshot { midi_input },
                Err(message) => control_error! { message },
            }
        }
        ControlCommand::StartRecording { config } => {
            match audio_engine.start_recording(RecordingStartConfig {
                path: config.path,
                asset_id: config.asset_id,
                originator: config.originator,
                origination_date: config.origination_date,
                origination_time: config.origination_time,
                time_reference: config.time_reference,
                sample_rate: config.sample_rate,
                channels: config.channels,
            }) {
                Ok(()) => ControlResult::Accepted,
                Err(error) => control_error! {
                    message: error.to_string(),
                },
            }
        }
        ControlCommand::StopRecording => match audio_engine.stop_recording() {
            Ok(value) => ControlResult::RecordingStopped { recording: value },
            Err(error) => control_error! {
                message: error.to_string(),
            },
        },
        ControlCommand::StartMidiRecording { config } => {
            match (|| {
                let clock = audio_engine
                    .transport_clock_handle()
                    .map_err(|error| error.to_string())?;
                let actor = MIDI_INPUT
                    .get()
                    .ok_or_else(|| "MIDI input actor is unavailable".to_owned())?;
                actor.start_recording(config, clock)
            })() {
                Ok(()) => ControlResult::Accepted,
                Err(message) => control_error! { message },
            }
        }
        ControlCommand::StopMidiRecording => {
            match MIDI_INPUT
                .get()
                .ok_or_else(|| "MIDI input actor is unavailable".to_owned())
                .and_then(|actor| actor.stop_recording())
            {
                Ok(recording) => ControlResult::MidiRecordingStopped { recording },
                Err(message) => control_error! { message },
            }
        }
        ControlCommand::RecordingWaveform {
            start_frame,
            end_frame,
            max_buckets,
        } => match audio_engine.recording_waveform_snapshot(start_frame, end_frame, max_buckets) {
            Ok(value) => ControlResult::RecordingWaveform { waveform: value },
            Err(error) => control_error! {
                message: error.to_string(),
            },
        },
        _ => return None,
    };
    Some(result)
}

#[cfg(test)]
mod tests;
