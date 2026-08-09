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
