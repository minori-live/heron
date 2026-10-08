//! Persisted atomic MIDI CC bindings. Channel-independent mapping follows the
//! first learned controller number; each CC has exactly one parameter owner.
use crate::params::EqParams;
use std::sync::atomic::{AtomicU32, Ordering};
use truce::{
    core::custom_state::{PersistField, StateCursor},
    prelude::*,
};

pub struct MidiBindings {
    values: [AtomicU32; 128],
}
impl Default for MidiBindings {
    fn default() -> Self {
        Self {
            values: std::array::from_fn(|_| AtomicU32::new(0)),
        }
    }
}

impl MidiBindings {
    pub fn bind(&self, controller: u8, param_id: u32) {
        self.clear(param_id);
        self.values[usize::from(controller.min(127))]
            .store(param_id.saturating_add(1), Ordering::Release);
    }
    pub fn clear(&self, param_id: u32) {
        for value in &self.values {
            let _ = value.compare_exchange(
                param_id.saturating_add(1),
                0,
                Ordering::AcqRel,
                Ordering::Relaxed,
            );
        }
    }
    pub fn controller_for(&self, param_id: u32) -> Option<u8> {
        self.values
            .iter()
            .position(|value| value.load(Ordering::Acquire) == param_id.saturating_add(1))
            .map(|index| index as u8)
    }
    pub fn target(&self, controller: u8) -> Option<u32> {
        let value = self.values[usize::from(controller.min(127))].load(Ordering::Acquire);
        value.checked_sub(1)
    }
}

impl PersistField for MidiBindings {
    fn persist_write(&self, buffer: &mut Vec<u8>) {
        for value in &self.values {
            buffer.extend_from_slice(&value.load(Ordering::Acquire).to_le_bytes());
        }
    }
    fn persist_read(&self, cursor: &mut StateCursor) {
        let Some(bytes) = cursor.read_bytes(128 * 4) else {
            return;
        };
        for (target, bytes) in self.values.iter().zip(bytes.as_chunks::<4>().0) {
            let value = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            // Only IDs in the immutable host automation schema can be restored.
            let id = value.saturating_sub(1);
            let valid = value == 0
                || matches!(id, 0..=5 | 7..=10)
                || (100..=855).contains(&id) && matches!((id - 100) % 32, 0..=7 | 19);
            target.store(if valid { value } else { 0 }, Ordering::Release);
        }
    }
}

pub fn process_cc(params: &EqParams, controller: u8, normalized: f64) {
    if let Some(target) = params.telemetry.learning() {
        if params.get_normalized(target).is_some() {
            params.midi_bindings.bind(controller, target);
        }
        params.telemetry.set_learning(None);
    }
    if let Some(target) = params.midi_bindings.target(controller) {
        params.set_normalized(target, normalized);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn learned_controller_changes_parameter_and_survives_host_state() {
        let params = EqParams::default();
        params.telemetry.set_learning(Some(104));
        process_cc(&params, 74, 0.75);
        assert_eq!(params.band01.gain.raw_target(), 18.0);
        assert_eq!(params.midi_bindings.controller_for(104), Some(74));
        let restored = EqParams::default();
        restored.load_persist(&params.serialize_persist());
        process_cc(&restored, 74, 0.25);
        assert_eq!(restored.band01.gain.raw_target(), -18.0);
        restored.midi_bindings.clear(104);
        assert_eq!(restored.midi_bindings.controller_for(104), None);
        params.midi_bindings.bind(7, 10);
        restored.load_persist(&params.serialize_persist());
        process_cc(&restored, 7, 1.0);
        assert!(restored.output_mute.value());
    }

    #[test]
    fn retired_targets_are_discarded_without_retargeting_static_band_bindings() {
        let original = EqParams::default();
        original.midi_bindings.bind(0, 6);
        original.midi_bindings.bind(1, 108);
        original.midi_bindings.bind(2, 858);
        original.midi_bindings.bind(3, 840);
        original.midi_bindings.bind(4, 855);
        let restored = EqParams::default();
        restored.load_persist(&original.serialize_persist());
        assert_eq!(restored.midi_bindings.target(0), None);
        assert_eq!(restored.midi_bindings.target(1), None);
        assert_eq!(restored.midi_bindings.target(2), None);
        assert_eq!(restored.midi_bindings.target(3), Some(840));
        assert_eq!(restored.midi_bindings.target(4), Some(855));
        process_cc(&restored, 1, 1.0);
        assert_eq!(restored.band01.gain.raw_target(), 0.0);
        process_cc(&restored, 3, 0.75);
        assert_eq!(restored.band24.gain.raw_target(), 18.0);
        process_cc(&restored, 4, 1.0);
        assert_eq!(restored.band24.order.value(), 23);
    }
}
