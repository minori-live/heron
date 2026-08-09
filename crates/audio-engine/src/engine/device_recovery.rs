use super::{
    AudioEngine, NativeAudioEngineConfig, NativeAudioRuntimeSnapshot, Ordering, Result, audio_error,
};
use crate::device::{self, NativeAudioDeviceList};
use std::time::{Duration, Instant};

const DEVICE_ENUMERATION_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeStreamDirection {
    Input,
    Output,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeDeviceFaultKind {
    DeviceNotAvailable,
    StreamInvalidated,
    HostUnavailable,
    DeviceBusy,
    BackendError,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct DeviceFaultSignal {
    pub(super) stream_incarnation: u64,
    pub(super) direction: NativeStreamDirection,
    pub(super) kind: NativeDeviceFaultKind,
}

#[derive(Clone)]
pub(super) struct StreamFaultReporter {
    pub(super) stream_incarnation: u64,
    pub(super) sender: std::sync::mpsc::SyncSender<DeviceFaultSignal>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeDeviceRecoveryPhase {
    WaitingForAuthorization,
    WaitingForChange,
    AttemptingOriginal,
    OriginalRestored,
    ApplyingSelection,
    SelectionFailed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeAudioDeviceRecoverySnapshot {
    pub recovery_id: u64,
    pub revision: u64,
    pub candidate_revision: u64,
    pub attempt_generation: u64,
    pub phase: NativeDeviceRecoveryPhase,
    pub original_config: NativeAudioEngineConfig,
    pub candidates: NativeAudioDeviceList,
    pub lost_input: bool,
    pub lost_output: bool,
    pub fault: NativeDeviceFaultKind,
}

#[derive(Debug)]
pub enum DeviceRecoveryAttempt {
    Committed(NativeAudioRuntimeSnapshot),
    Superseded,
}

pub(super) struct DeviceRecoveryState {
    recovery_id: u64,
    revision: u64,
    candidate_revision: u64,
    attempt_generation: u64,
    phase: NativeDeviceRecoveryPhase,
    original_config: NativeAudioEngineConfig,
    candidates: NativeAudioDeviceList,
    lost_input: bool,
    lost_output: bool,
    fault: NativeDeviceFaultKind,
    authorized: bool,
    immediate_attempt: bool,
    last_enumerated_at: Option<Instant>,
    last_signature: Vec<String>,
}

impl DeviceRecoveryState {
    fn snapshot(&self) -> NativeAudioDeviceRecoverySnapshot {
        NativeAudioDeviceRecoverySnapshot {
            recovery_id: self.recovery_id,
            revision: self.revision,
            candidate_revision: self.candidate_revision,
            attempt_generation: self.attempt_generation,
            phase: self.phase,
            original_config: self.original_config.clone(),
            candidates: self.candidates.clone(),
            lost_input: self.lost_input,
            lost_output: self.lost_output,
            fault: self.fault,
        }
    }

    fn bump(&mut self) {
        self.revision = self.revision.saturating_add(1);
    }
}

fn empty_devices() -> NativeAudioDeviceList {
    NativeAudioDeviceList {
        inputs: Vec::new(),
        outputs: Vec::new(),
    }
}

fn device_signature(devices: &NativeAudioDeviceList) -> Vec<String> {
    let signature = |direction: char, device: &crate::device::NativeAudioDevice| {
        format!(
            "{direction}:{}:{:?}:{:?}:{:?}:{:?}",
            device.id,
            device.default_sample_rate,
            device.min_buffer_size,
            device.max_buffer_size,
            device.channel_count
        )
    };
    let mut signature = devices
        .inputs
        .iter()
        .map(|device| signature('i', device))
        .chain(devices.outputs.iter().map(|device| signature('o', device)))
        .collect::<Vec<_>>();
    signature.sort_unstable();
    signature
}

fn original_devices_visible(
    config: &NativeAudioEngineConfig,
    devices: &NativeAudioDeviceList,
) -> bool {
    devices
        .inputs
        .iter()
        .any(|device| device.id == config.input_device_id)
        && devices
            .outputs
            .iter()
            .any(|device| device.id == config.output_device_id)
}

impl AudioEngine {
    pub(super) fn record_superseded_recovery(&self, stage: &str, generation: u64) {
        eprintln!(
            "audio_device_recovery event=superseded_attempt stage={stage} generation={generation} current_generation={}",
            self.recovery_authority.load(Ordering::Acquire)
        );
    }

    pub(super) fn recovery_commit_guard(&self) -> std::sync::MutexGuard<'_, ()> {
        match self.recovery_commit.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    pub(super) fn claim_recovery_generation(&self) -> u64 {
        let _commit = self.recovery_commit_guard();
        self.recovery_authority.fetch_add(1, Ordering::AcqRel) + 1
    }

    pub fn device_recovery_snapshot(&self) -> Option<NativeAudioDeviceRecoverySnapshot> {
        self.device_recovery
            .lock()
            .ok()
            .and_then(|state| state.as_ref().map(DeviceRecoveryState::snapshot))
    }

    pub fn observe_device_faults(&self) -> bool {
        let current_incarnation = self.current_stream_incarnation.load(Ordering::Acquire);
        let signals = self
            .device_fault_receiver
            .lock()
            .map(|receiver| receiver.try_iter().collect::<Vec<_>>())
            .unwrap_or_default();
        let Some(config) = self
            .current_audio_config
            .lock()
            .ok()
            .and_then(|config| config.clone())
        else {
            return false;
        };
        let mut changed = false;
        let Ok(mut recovery) = self.device_recovery.lock() else {
            return false;
        };
        for signal in signals {
            if signal.stream_incarnation != current_incarnation {
                eprintln!(
                    "audio_device_recovery event=stale_stream_fault stream_incarnation={} current_incarnation={current_incarnation}",
                    signal.stream_incarnation
                );
                continue;
            }
            if let Some(state) = recovery.as_mut() {
                state.lost_input |= signal.direction == NativeStreamDirection::Input;
                state.lost_output |= signal.direction == NativeStreamDirection::Output;
                state.fault = signal.kind;
                state.phase = if state.authorized {
                    NativeDeviceRecoveryPhase::WaitingForChange
                } else {
                    NativeDeviceRecoveryPhase::WaitingForAuthorization
                };
                state.immediate_attempt = state.authorized;
                state.bump();
            } else {
                *recovery = Some(DeviceRecoveryState {
                    recovery_id: self.next_recovery_id.fetch_add(1, Ordering::Relaxed),
                    revision: 1,
                    candidate_revision: 0,
                    attempt_generation: self.recovery_authority.load(Ordering::Acquire),
                    phase: NativeDeviceRecoveryPhase::WaitingForAuthorization,
                    original_config: config.clone(),
                    candidates: empty_devices(),
                    lost_input: signal.direction == NativeStreamDirection::Input,
                    lost_output: signal.direction == NativeStreamDirection::Output,
                    fault: signal.kind,
                    authorized: false,
                    immediate_attempt: false,
                    last_enumerated_at: None,
                    last_signature: Vec::new(),
                });
            }
            changed = true;
        }
        changed
    }

    pub fn authorize_device_recovery(&self, recovery_id: u64) -> Result<()> {
        let mut recovery = self
            .device_recovery
            .lock()
            .map_err(|_| audio_error("device recovery lock", "poisoned"))?;
        let state = recovery
            .as_mut()
            .filter(|state| state.recovery_id == recovery_id)
            .ok_or_else(|| audio_error("device recovery", "stale recovery decision"))?;
        state.authorized = true;
        state.immediate_attempt = true;
        state.phase = NativeDeviceRecoveryPhase::WaitingForChange;
        state.bump();
        Ok(())
    }

    pub fn keep_restored_device(&self, recovery_id: u64) -> Result<()> {
        let mut recovery = self
            .device_recovery
            .lock()
            .map_err(|_| audio_error("device recovery lock", "poisoned"))?;
        let can_keep = recovery.as_ref().is_some_and(|state| {
            state.recovery_id == recovery_id
                && state.phase == NativeDeviceRecoveryPhase::OriginalRestored
        });
        if !can_keep {
            return Err(audio_error(
                "device recovery",
                "the original device is not restored",
            ));
        }
        *recovery = None;
        Ok(())
    }

    pub fn cancel_device_recovery(&self) {
        self.claim_recovery_generation();
        if let Ok(mut recovery) = self.device_recovery.lock() {
            *recovery = None;
        }
    }

    pub fn select_recovery_device(
        &self,
        recovery_id: u64,
        config: NativeAudioEngineConfig,
    ) -> Result<NativeAudioRuntimeSnapshot> {
        let (original, restore_original_on_failure, generation) = {
            let mut recovery = self
                .device_recovery
                .lock()
                .map_err(|_| audio_error("device recovery lock", "poisoned"))?;
            let state = recovery
                .as_mut()
                .filter(|state| state.recovery_id == recovery_id)
                .ok_or_else(|| audio_error("device recovery", "stale recovery decision"))?;
            if config.backend != state.original_config.backend {
                return Err(audio_error(
                    "device recovery",
                    "replacement devices must use the original backend",
                ));
            }
            let restore_original_on_failure =
                state.phase == NativeDeviceRecoveryPhase::OriginalRestored;
            let generation = self.claim_recovery_generation();
            state.attempt_generation = generation;
            state.phase = NativeDeviceRecoveryPhase::ApplyingSelection;
            state.bump();
            (
                state.original_config.clone(),
                restore_original_on_failure,
                generation,
            )
        };

        match self.start_audio_engine_generation(config, generation) {
            Ok(DeviceRecoveryAttempt::Committed(runtime)) => {
                if let Ok(mut recovery) = self.device_recovery.lock()
                    && recovery
                        .as_ref()
                        .is_some_and(|state| state.recovery_id == recovery_id)
                {
                    *recovery = None;
                }
                Ok(runtime)
            }
            Ok(DeviceRecoveryAttempt::Superseded) => Err(audio_error(
                "device recovery",
                "device selection was superseded",
            )),
            Err(error) => {
                if let Ok(mut recovery) = self.device_recovery.lock()
                    && let Some(state) = recovery
                        .as_mut()
                        .filter(|state| state.recovery_id == recovery_id)
                {
                    state.phase = NativeDeviceRecoveryPhase::SelectionFailed;
                    state.bump();
                }
                if restore_original_on_failure {
                    let rollback_generation = self.claim_recovery_generation();
                    let _ = self.start_audio_engine_generation(original, rollback_generation);
                }
                Err(error)
            }
        }
    }

    pub fn poll_device_recovery(&self) -> bool {
        let _ = self.observe_device_faults();
        let now = Instant::now();
        let plan = {
            let Ok(mut recovery) = self.device_recovery.lock() else {
                return false;
            };
            let Some(state) = recovery.as_mut() else {
                return false;
            };
            let due = state
                .last_enumerated_at
                .is_none_or(|last| now.duration_since(last) >= DEVICE_ENUMERATION_INTERVAL);
            if !due && !state.immediate_attempt {
                return false;
            }
            state.last_enumerated_at = Some(now);
            Some((
                state.recovery_id,
                state.original_config.clone(),
                state.immediate_attempt,
                state.authorized,
            ))
        };
        let Some((recovery_id, config, immediate, authorized)) = plan else {
            return false;
        };

        let devices = match device::list_audio_devices(config.backend.clone()) {
            Ok(devices) => devices,
            Err(_) => empty_devices(),
        };
        let signature = device_signature(&devices);
        let should_attempt = {
            let Ok(mut recovery) = self.device_recovery.lock() else {
                return false;
            };
            let Some(state) = recovery
                .as_mut()
                .filter(|state| state.recovery_id == recovery_id)
            else {
                return false;
            };
            let list_changed = signature != state.last_signature;
            if list_changed || state.candidates != devices {
                state.candidates = devices.clone();
                state.last_signature.clone_from(&signature);
                state.candidate_revision = state.candidate_revision.saturating_add(1);
                state.bump();
            }
            state.immediate_attempt = false;
            authorized
                && (immediate || list_changed)
                && original_devices_visible(&config, &devices)
                && state.phase != NativeDeviceRecoveryPhase::OriginalRestored
        };
        if !should_attempt {
            return true;
        }

        let generation = self.claim_recovery_generation();
        if let Ok(mut recovery) = self.device_recovery.lock()
            && let Some(state) = recovery
                .as_mut()
                .filter(|state| state.recovery_id == recovery_id)
        {
            state.attempt_generation = generation;
            state.phase = NativeDeviceRecoveryPhase::AttemptingOriginal;
            state.bump();
        }
        let result = self.start_audio_engine_generation(config, generation);
        if let Ok(mut recovery) = self.device_recovery.lock()
            && let Some(state) = recovery
                .as_mut()
                .filter(|state| state.recovery_id == recovery_id)
            && state.attempt_generation == generation
        {
            state.phase = match result {
                Ok(DeviceRecoveryAttempt::Committed(_)) => {
                    NativeDeviceRecoveryPhase::OriginalRestored
                }
                Ok(DeviceRecoveryAttempt::Superseded) | Err(_) => {
                    NativeDeviceRecoveryPhase::WaitingForChange
                }
            };
            state.bump();
        }
        true
    }
}
