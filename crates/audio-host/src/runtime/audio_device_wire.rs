use super::{
    AudioDevice, AudioDeviceFaultKind, AudioDeviceList, AudioDeviceRecovery,
    AudioDeviceRecoveryPhase, AudioEngineConfig, AudioStreamDirection, device, engine,
};

pub(super) fn audio_device_list(value: device::NativeAudioDeviceList) -> AudioDeviceList {
    let convert = |value: device::NativeAudioDevice| AudioDevice {
        id: value.id,
        name: value.name,
        is_default: value.is_default,
        default_sample_rate: value.default_sample_rate,
        min_buffer_size: value.min_buffer_size,
        max_buffer_size: value.max_buffer_size,
        channel_count: value.channel_count,
    };
    AudioDeviceList {
        inputs: value.inputs.into_iter().map(convert).collect(),
        outputs: value.outputs.into_iter().map(convert).collect(),
    }
}

pub(super) fn audio_device_recovery(
    value: engine::NativeAudioDeviceRecoverySnapshot,
) -> AudioDeviceRecovery {
    let phase = match value.phase {
        engine::NativeDeviceRecoveryPhase::WaitingForAuthorization => {
            AudioDeviceRecoveryPhase::WaitingForAuthorization
        }
        engine::NativeDeviceRecoveryPhase::WaitingForChange => {
            AudioDeviceRecoveryPhase::WaitingForChange
        }
        engine::NativeDeviceRecoveryPhase::AttemptingOriginal => {
            AudioDeviceRecoveryPhase::AttemptingOriginal
        }
        engine::NativeDeviceRecoveryPhase::OriginalRestored => {
            AudioDeviceRecoveryPhase::OriginalRestored
        }
        engine::NativeDeviceRecoveryPhase::ApplyingSelection => {
            AudioDeviceRecoveryPhase::ApplyingSelection
        }
        engine::NativeDeviceRecoveryPhase::SelectionFailed => {
            AudioDeviceRecoveryPhase::SelectionFailed
        }
    };
    let fault = match value.fault {
        engine::NativeDeviceFaultKind::DeviceNotAvailable => {
            AudioDeviceFaultKind::DeviceNotAvailable
        }
        engine::NativeDeviceFaultKind::StreamInvalidated => AudioDeviceFaultKind::StreamInvalidated,
        engine::NativeDeviceFaultKind::HostUnavailable => AudioDeviceFaultKind::HostUnavailable,
        engine::NativeDeviceFaultKind::DeviceBusy => AudioDeviceFaultKind::DeviceBusy,
        engine::NativeDeviceFaultKind::BackendError => AudioDeviceFaultKind::BackendError,
    };
    let mut lost_directions = Vec::with_capacity(2);
    if value.lost_input {
        lost_directions.push(AudioStreamDirection::Input);
    }
    if value.lost_output {
        lost_directions.push(AudioStreamDirection::Output);
    }
    AudioDeviceRecovery {
        recovery_id: value.recovery_id,
        revision: value.revision,
        candidate_revision: value.candidate_revision,
        attempt_generation: value.attempt_generation,
        phase,
        original_config: AudioEngineConfig {
            backend: value.original_config.backend,
            input_device_id: value.original_config.input_device_id,
            output_device_id: value.original_config.output_device_id,
            buffer_size: value.original_config.buffer_size,
            session_sample_rate: value.original_config.session_sample_rate,
        },
        candidates: audio_device_list(value.candidates),
        lost_directions,
        fault,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn native_device(id: &str) -> device::NativeAudioDevice {
        device::NativeAudioDevice {
            id: id.to_owned(),
            name: id.to_owned(),
            is_default: id == "input",
            default_sample_rate: Some(48_000),
            min_buffer_size: Some(32),
            max_buffer_size: Some(2_048),
            channel_count: Some(2),
        }
    }

    fn recovery(
        phase: engine::NativeDeviceRecoveryPhase,
        fault: engine::NativeDeviceFaultKind,
    ) -> engine::NativeAudioDeviceRecoverySnapshot {
        engine::NativeAudioDeviceRecoverySnapshot {
            recovery_id: 7,
            revision: 8,
            candidate_revision: 9,
            attempt_generation: 10,
            phase,
            original_config: engine::NativeAudioEngineConfig {
                backend: "mock".to_owned(),
                input_device_id: "input".to_owned(),
                output_device_id: "output".to_owned(),
                buffer_size: 128,
                session_sample_rate: Some(48_000),
            },
            candidates: device::NativeAudioDeviceList {
                inputs: vec![native_device("input")],
                outputs: vec![native_device("output")],
            },
            lost_input: true,
            lost_output: true,
            fault,
        }
    }

    #[test]
    fn audio_device_list_preserves_capabilities_and_direction() {
        let converted = audio_device_list(device::NativeAudioDeviceList {
            inputs: vec![native_device("input")],
            outputs: vec![native_device("output")],
        });

        assert_eq!(converted.inputs[0].id, "input");
        assert!(converted.inputs[0].is_default);
        assert_eq!(converted.outputs[0].default_sample_rate, Some(48_000));
        assert_eq!(converted.outputs[0].max_buffer_size, Some(2_048));
    }

    #[test]
    fn recovery_maps_every_phase_and_fault_to_the_wire_protocol() {
        let cases = [
            (
                engine::NativeDeviceRecoveryPhase::WaitingForAuthorization,
                engine::NativeDeviceFaultKind::DeviceNotAvailable,
                AudioDeviceRecoveryPhase::WaitingForAuthorization,
                AudioDeviceFaultKind::DeviceNotAvailable,
            ),
            (
                engine::NativeDeviceRecoveryPhase::WaitingForChange,
                engine::NativeDeviceFaultKind::StreamInvalidated,
                AudioDeviceRecoveryPhase::WaitingForChange,
                AudioDeviceFaultKind::StreamInvalidated,
            ),
            (
                engine::NativeDeviceRecoveryPhase::AttemptingOriginal,
                engine::NativeDeviceFaultKind::HostUnavailable,
                AudioDeviceRecoveryPhase::AttemptingOriginal,
                AudioDeviceFaultKind::HostUnavailable,
            ),
            (
                engine::NativeDeviceRecoveryPhase::OriginalRestored,
                engine::NativeDeviceFaultKind::DeviceBusy,
                AudioDeviceRecoveryPhase::OriginalRestored,
                AudioDeviceFaultKind::DeviceBusy,
            ),
            (
                engine::NativeDeviceRecoveryPhase::ApplyingSelection,
                engine::NativeDeviceFaultKind::BackendError,
                AudioDeviceRecoveryPhase::ApplyingSelection,
                AudioDeviceFaultKind::BackendError,
            ),
            (
                engine::NativeDeviceRecoveryPhase::SelectionFailed,
                engine::NativeDeviceFaultKind::BackendError,
                AudioDeviceRecoveryPhase::SelectionFailed,
                AudioDeviceFaultKind::BackendError,
            ),
        ];

        for (native_phase, native_fault, expected_phase, expected_fault) in cases {
            let converted = audio_device_recovery(recovery(native_phase, native_fault));
            assert_eq!(converted.phase, expected_phase);
            assert_eq!(converted.fault, expected_fault);
            assert_eq!(converted.lost_directions.len(), 2);
            assert_eq!(converted.original_config.session_sample_rate, Some(48_000));
        }
    }
}
