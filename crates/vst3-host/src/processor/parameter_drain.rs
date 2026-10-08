//! GUI values are coalesced before bounded VST3 storage admission.
//! All memory is prepared with the processor; process/flush never allocate.
use super::QueuedParameter;
use crate::{
    HostError, HostResult,
    parameter_changes::{ParameterChanges, QUEUE_CAPACITY},
};
use ringbuf::{
    HeapCons,
    traits::{Consumer, Observer},
};

// Equal to the existing UI ring's admission capacity. If the deferred stash is
// full, unadmitted distinct IDs remain in the ring rather than being popped.
const PENDING_CAPACITY: usize = 1024;
const INDEX_CAPACITY: usize = PENDING_CAPACITY * 2;
const CONTROL_FLUSH_PASSES: usize = (PENDING_CAPACITY * 2).div_ceil(QUEUE_CAPACITY);

enum Location {
    Existing(usize),
    Vacant(usize),
}

pub(crate) struct GuiParameterDrain {
    pending: [QueuedParameter; PENDING_CAPACITY],
    index: [u16; INDEX_CAPACITY],
    len: usize,
}

impl GuiParameterDrain {
    pub(crate) fn new() -> Box<Self> {
        Box::new(Self {
            pending: [QueuedParameter { id: 0, value: 0.0 }; PENDING_CAPACITY],
            index: [0; INDEX_CAPACITY],
            len: 0,
        })
    }

    pub(crate) fn drain(
        &mut self,
        consumer: &mut HeapCons<QueuedParameter>,
        changes: &mut ParameterChanges,
    ) {
        self.index.fill(0);
        for index in 0..self.len {
            if let Some(Location::Vacant(bucket)) = self.locate(self.pending[index].id) {
                self.index[bucket] = (index + 1) as u16;
            }
        }
        // A concurrently active UI producer cannot extend this callback's
        // budget. Last writes within this snapshot replace older pending ones.
        let available = consumer.occupied_len();
        for _ in 0..available {
            let Some(parameter) = consumer.first().copied() else {
                break;
            };
            match self.locate(parameter.id) {
                Some(Location::Existing(index)) => self.pending[index] = parameter,
                Some(Location::Vacant(bucket)) if self.len < PENDING_CAPACITY => {
                    self.pending[self.len] = parameter;
                    self.index[bucket] = (self.len + 1) as u16;
                    self.len += 1;
                }
                _ => break,
            }
            let _ = consumer.try_pop();
        }

        // Retain every admitted UI value that cannot fit this process call.
        // Coalescing happens first, so a terminal correction is preferred even
        // when its ID must wait behind the per-call 64-queue/512-point bounds.
        let mut deferred = 0;
        for index in 0..self.len {
            let parameter = self.pending[index];
            if !changes.add_gui_value(parameter.id, parameter.value) {
                self.pending[deferred] = parameter;
                deferred += 1;
            }
        }
        self.len = deferred;
    }

    /// State capture runs on the serialized controller thread, with audio
    /// paused. Finish its existing stash+ring admission (<=2048 distinct IDs)
    /// before serializing component state. Failure stops immediately.
    pub(crate) fn flush_control(
        &mut self,
        consumer: &mut HeapCons<QueuedParameter>,
        changes: &mut ParameterChanges,
        mut process: impl FnMut(&mut ParameterChanges) -> HostResult<()>,
    ) -> HostResult<()> {
        for _ in 0..CONTROL_FLUSH_PASSES {
            changes.clear();
            self.drain(consumer, changes);
            if changes.is_empty() {
                return Ok(());
            }
            let result = process(changes);
            changes.clear();
            result?;
            if self.len == 0 && consumer.occupied_len() == 0 {
                return Ok(());
            }
        }
        Err(HostError::QueueFull {
            operation: "flush admitted GUI parameters",
        })
    }

    fn locate(&self, id: u32) -> Option<Location> {
        // Multiplicative hashing distributes common sequential parameter IDs;
        // even collisions have an explicit fixed probe budget. Load is <=1/2.
        let mut bucket = (id.wrapping_mul(0x9e37_79b1) >> 21) as usize;
        for _ in 0..INDEX_CAPACITY {
            let entry = self.index[bucket];
            if entry == 0 {
                return Some(Location::Vacant(bucket));
            }
            let index = usize::from(entry - 1);
            if self.pending[index].id == id {
                return Some(Location::Existing(index));
            }
            bucket = (bucket + 1) & (INDEX_CAPACITY - 1);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component_handler::HandlerShared;
    use heron_vst3_host_sys::abi::{ParamValueQueueVTable, ParameterChangesVTable};
    use ringbuf::{HeapRb, traits::Split};

    fn wire_points(changes: &mut ParameterChanges) -> Vec<(u32, i32, f64)> {
        let mut result = Vec::new();
        let interface = changes.as_interface();
        // SAFETY: these are this host's live, uniquely borrowed parameter
        // interfaces and initialized output slots, exactly as in process().
        unsafe {
            let table = *interface.cast::<*const ParameterChangesVTable>();
            for index in 0..((*table).parameter_count)(interface) {
                let queue = ((*table).parameter_data)(interface, index);
                let queue_table = *queue.cast::<*const ParamValueQueueVTable>();
                let id = ((*queue_table).parameter_id)(queue);
                for point in 0..((*queue_table).point_count)(queue) {
                    let mut offset = -1;
                    let mut value = f64::NAN;
                    assert_eq!(
                        ((*queue_table).point)(queue, point, &mut offset, &mut value),
                        0
                    );
                    result.push((id, offset, value));
                }
            }
        }
        result
    }

    #[test]
    fn terminal_gui_correction_survives_more_than_32_drag_steps() {
        let (producer, mut consumer) = HeapRb::new(1024).split();
        let host = HandlerShared::new(producer);
        for step in 1..=200 {
            assert!(host.enqueue_parameter(42, f64::from(step) / 256.0));
        }
        assert!(host.enqueue_parameter(42, 0.25));
        let mut drain = GuiParameterDrain::new();
        let mut changes = ParameterChanges::new();
        drain.drain(&mut consumer, &mut changes);
        assert_eq!(wire_points(&mut changes), [(42, 0, 0.25)]);
        assert_eq!(consumer.occupied_len(), 0);
    }

    #[test]
    fn deferred_unique_gui_ids_keep_terminal_corrections_across_blocks() {
        let (producer, mut consumer) = HeapRb::new(1024).split();
        let host = HandlerShared::new(producer);
        for id in 0..130 {
            assert!(host.enqueue_parameter(id, 0.2));
        }
        assert!(host.enqueue_parameter(75, 0.5));
        let mut drain = GuiParameterDrain::new();
        let mut changes = ParameterChanges::new();
        drain.drain(&mut consumer, &mut changes);
        let mut delivered = wire_points(&mut changes);
        assert_eq!(delivered.len(), 64);
        assert_eq!(consumer.occupied_len(), 0);

        assert!(host.enqueue_parameter(75, 0.9));
        for _ in 0..2 {
            changes.clear();
            drain.drain(&mut consumer, &mut changes);
            delivered.extend(wire_points(&mut changes));
        }
        delivered.sort_unstable_by_key(|point| point.0);
        let expected: Vec<_> = (0..130)
            .map(|id| (id, 0, if id == 75 { 0.9 } else { 0.2 }))
            .collect();
        assert_eq!(delivered, expected);
    }

    #[test]
    fn gui_initial_values_preserve_sample_offset_automation_and_its_order() {
        let (producer, mut consumer) = HeapRb::new(1024).split();
        let host = HandlerShared::new(producer);
        let mut drain = GuiParameterDrain::new();
        let mut changes = ParameterChanges::new();
        assert!(changes.add_value(7, 0, 0.2));
        assert!(changes.add_value(7, 17, 0.8));
        assert!(changes.add_value(9, 9, 0.4));
        assert!(host.enqueue_parameter(7, 0.3));
        assert!(host.enqueue_parameter(7, 0.9));
        drain.drain(&mut consumer, &mut changes);
        assert_eq!(
            wire_points(&mut changes),
            [(7, 0, 0.9), (7, 0, 0.2), (7, 17, 0.8), (9, 9, 0.4)]
        );
    }

    #[test]
    fn conservative_gui_wire_budget_preserves_automation_admission() {
        let (producer, mut consumer) = HeapRb::new(1024).split();
        let host = HandlerShared::new(producer);
        let mut drain = GuiParameterDrain::new();
        let mut changes = ParameterChanges::new();
        for id in 0..16 {
            for offset in 0..32 {
                assert!(changes.add_value(id, offset, 0.2));
            }
        }
        assert!(changes.add_value(16, 7, 0.2));
        assert!(host.enqueue_parameter(0, 0.5));
        assert!(host.enqueue_parameter(16, 0.7));
        drain.drain(&mut consumer, &mut changes);
        assert_eq!(wire_points(&mut changes).len(), 513);
        changes.clear();
        drain.drain(&mut consumer, &mut changes);
        assert_eq!(wire_points(&mut changes), [(0, 0, 0.5), (16, 0, 0.7)]);
    }

    #[test]
    fn full_pending_storage_retains_unadmitted_ring_values_until_later_blocks() {
        let (producer, mut consumer) = HeapRb::new(1024).split();
        let host = HandlerShared::new(producer);
        let mut drain = GuiParameterDrain::new();
        let mut changes = ParameterChanges::new();
        for id in 0..1024 {
            assert!(host.enqueue_parameter(id, 0.4));
        }
        drain.drain(&mut consumer, &mut changes);
        let mut delivered = wire_points(&mut changes);
        for id in 1024..2048 {
            assert!(host.enqueue_parameter(id, 0.6));
        }
        changes.clear();
        drain.drain(&mut consumer, &mut changes);
        delivered.extend(wire_points(&mut changes));
        assert!(consumer.occupied_len() > 0);
        for _ in 0..30 {
            changes.clear();
            drain.drain(&mut consumer, &mut changes);
            delivered.extend(wire_points(&mut changes));
        }
        delivered.sort_unstable_by_key(|point| point.0);
        let expected: Vec<_> = (0..2048)
            .map(|id| (id, 0, if id < 1024 { 0.4 } else { 0.6 }))
            .collect();
        assert_eq!(delivered, expected);
        assert_eq!(consumer.occupied_len(), 0);
    }

    #[test]
    fn control_state_flush_finishes_deferred_values_and_stops_on_failure() {
        let (producer, mut consumer) = HeapRb::new(1024).split();
        let host = HandlerShared::new(producer);
        let mut drain = GuiParameterDrain::new();
        let mut changes = ParameterChanges::new();
        for id in 0..1024 {
            assert!(host.enqueue_parameter(id, 0.4));
        }
        drain.drain(&mut consumer, &mut changes);
        let mut captured = wire_points(&mut changes);
        for id in 1024..2048 {
            assert!(host.enqueue_parameter(id, 0.6));
        }
        let mut passes = 0;
        drain
            .flush_control(&mut consumer, &mut changes, |changes| {
                passes += 1;
                captured.extend(wire_points(changes));
                Ok(())
            })
            .unwrap();
        captured.sort_unstable_by_key(|point| point.0);
        let expected: Vec<_> = (0..2048)
            .map(|id| (id, 0, if id < 1024 { 0.4 } else { 0.6 }))
            .collect();
        assert_eq!(captured, expected);
        assert_eq!(passes, 31);
        assert_eq!(consumer.occupied_len(), 0);

        for id in 0..130 {
            assert!(host.enqueue_parameter(id, 0.2));
        }
        let mut attempts = 0;
        let result = drain.flush_control(&mut consumer, &mut changes, |_| {
            attempts += 1;
            Err(HostError::Operation {
                operation: "controlled parameter flush",
                result: 1,
            })
        });
        assert!(matches!(
            result,
            Err(HostError::Operation { result: 1, .. })
        ));
        assert_eq!(attempts, 1);
    }
}
