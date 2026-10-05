use std::{
    cell::{Cell, UnsafeCell},
    marker::PhantomData,
    ptr::NonNull,
    sync::Arc,
};

use heron_audio_plugin::{PluginProcessFailure, ProcessOutcome};

use crate::{HostError, StereoProcessor, processor::HostProcessContext};

use super::processing_access::{ProcessingAccess, ProcessingClaim};
use super::{MIDI_AFTERTOUCH, MIDI_PITCH_BEND, MIDI_PROGRAM_CHANGE, MidiMappingTable};

pub(super) struct ProcessorCell {
    processor: UnsafeCell<StereoProcessor>,
    access: ProcessingAccess,
}

impl ProcessorCell {
    pub(super) fn new(processor: StereoProcessor) -> Box<Self> {
        Box::new(Self {
            processor: UnsafeCell::new(processor),
            access: ProcessingAccess::default(),
        })
    }

    pub(super) fn with_paused<T>(&self, action: impl FnOnce(&mut StereoProcessor) -> T) -> T {
        self.access.with_paused(|| unsafe {
            // SAFETY: paused prevents the audio lease from entering and processing is false, so
            // the UI thread has exclusive access until paused is cleared.
            action(&mut *self.processor.get())
        })
    }

    pub(super) fn with_access_paused<T>(&self, action: impl FnOnce() -> T) -> T {
        self.access.with_paused(action)
    }

    pub(super) fn with_pair_transaction<T>(
        &self,
        secondary: Option<&Self>,
        recovery: bool,
        action: impl FnOnce() -> crate::HostResult<T>,
    ) -> crate::HostResult<T> {
        self.access
            .with_pair_transaction(secondary.map(|lane| &lane.access), recovery, action)
    }

    pub(super) fn with_paused_restart<T>(
        &self,
        action: impl FnOnce(&mut StereoProcessor) -> crate::HostResult<T>,
    ) -> crate::HostResult<T> {
        self.access.with_paused_restart(|| unsafe {
            // SAFETY: the access guard paused and drained the audio lease.
            action(&mut *self.processor.get())
        })
    }

    /// Keeps an uncertain instance out of the callback until a recovery succeeds.
    pub(super) fn with_paused_recovery<T, E>(
        &self,
        action: impl FnOnce(&mut StereoProcessor) -> Result<T, E>,
    ) -> Result<T, E> {
        self.access.with_paused_recovery(|| unsafe {
            // SAFETY: the access guard has paused and drained the audio lease.
            action(&mut *self.processor.get())
        })
    }

    /// Preserves an existing barrier and keeps selected failed mutations paused.
    pub(super) fn with_paused_policy<T, E>(
        &self,
        action: impl FnOnce(&mut StereoProcessor) -> Result<T, E>,
        quarantine: impl FnOnce(&E) -> bool,
    ) -> Result<T, E> {
        self.access.with_paused_policy(
            || unsafe {
                // SAFETY: the access guard has paused and drained all audio-thread accesses.
                action(&mut *self.processor.get())
            },
            quarantine,
        )
    }
}

pub struct ProcessorLease {
    pub(super) cell: NonNull<ProcessorCell>,
    pub(super) midi_mapping: Arc<MidiMappingTable>,
    pub(super) _lifetime: Arc<()>,
    pub(super) _not_sync: PhantomData<Cell<()>>,
}

pub(crate) struct ProcessorAccess<'a> {
    processor: &'a UnsafeCell<StereoProcessor>,
    _claim: ProcessingClaim<'a>,
}

impl ProcessorAccess<'_> {
    pub(crate) fn process_block_with_aux(
        &mut self,
        input_left: &mut [f32],
        input_right: &mut [f32],
        output_left: &mut [f32],
        output_right: &mut [f32],
        auxiliary_inputs: &[crate::processor::AuxiliaryAudioInput],
        context: &HostProcessContext,
    ) -> ProcessOutcome {
        let result = unsafe {
            // SAFETY: the held exclusive claim excludes UI mutation and other
            // callback access for the complete lifetime of this endpoint.
            (&mut *self.processor.get()).process_stereo_with_aux_context(
                input_left,
                input_right,
                output_left,
                output_right,
                auxiliary_inputs,
                Some(context),
            )
        };
        match result {
            Ok(()) => ProcessOutcome::Processed,
            Err(HostError::Operation { result, .. }) => {
                ProcessOutcome::Failed(PluginProcessFailure::NativeRejected(result))
            }
            Err(_) => ProcessOutcome::Failed(PluginProcessFailure::Rejected),
        }
    }
}

impl Clone for ProcessorLease {
    fn clone(&self) -> Self {
        Self {
            cell: self.cell,
            midi_mapping: Arc::clone(&self.midi_mapping),
            _lifetime: Arc::clone(&self._lifetime),
            _not_sync: PhantomData,
        }
    }
}

// SAFETY: A processor lease is transferred to one audio graph generation at a time. The !Sync
// marker prevents shared cross-thread calls; retired graph generations finish before owner drop.
unsafe impl Send for ProcessorLease {}

impl ProcessorLease {
    pub(crate) fn try_processing(&self) -> Option<ProcessorAccess<'_>> {
        let cell = unsafe {
            // SAFETY: the owner keeps the stable cell alive for the lease's
            // lifetime, including any claim borrowing this lease.
            self.cell.as_ref()
        };
        Some(ProcessorAccess {
            processor: &cell.processor,
            _claim: cell.access.try_claim()?,
        })
    }

    pub fn process_block(
        &mut self,
        input_left: &mut [f32],
        input_right: &mut [f32],
        output_left: &mut [f32],
        output_right: &mut [f32],
        context: &HostProcessContext,
    ) -> bool {
        self.process_block_with_aux(
            input_left,
            input_right,
            output_left,
            output_right,
            &[],
            context,
        )
        .is_processed()
    }

    pub(crate) fn process_block_with_aux(
        &mut self,
        input_left: &mut [f32],
        input_right: &mut [f32],
        output_left: &mut [f32],
        output_right: &mut [f32],
        auxiliary_inputs: &[crate::processor::AuxiliaryAudioInput],
        context: &HostProcessContext,
    ) -> ProcessOutcome {
        let Some(mut access) = self.try_processing() else {
            return ProcessOutcome::TemporarilyUnavailable;
        };
        access.process_block_with_aux(
            input_left,
            input_right,
            output_left,
            output_right,
            auxiliary_inputs,
            context,
        )
    }

    pub fn note_on(
        &mut self,
        sample_offset: i32,
        channel: u8,
        key: u8,
        velocity: u8,
        note_id: i32,
    ) -> bool {
        self.queue_note(true, sample_offset, channel, key, velocity, note_id)
    }

    pub fn note_off(
        &mut self,
        sample_offset: i32,
        channel: u8,
        key: u8,
        velocity: u8,
        note_id: i32,
    ) -> bool {
        self.queue_note(false, sample_offset, channel, key, velocity, note_id)
    }

    fn queue_note(
        &mut self,
        note_on: bool,
        sample_offset: i32,
        channel: u8,
        key: u8,
        velocity: u8,
        note_id: i32,
    ) -> bool {
        let cell = unsafe {
            // SAFETY: the owner keeps this stable cell alive for the lease lifetime.
            self.cell.as_ref()
        };
        cell.access
            .try_access(|| unsafe {
                // SAFETY: the same audio access guard as process_block excludes UI mutation.
                let processor = &mut *cell.processor.get();
                if note_on {
                    processor.queue_note_on(
                        sample_offset,
                        i16::from(channel),
                        i16::from(key),
                        f32::from(velocity) / 127.0,
                        note_id,
                    )
                } else {
                    processor.queue_note_off(
                        sample_offset,
                        i16::from(channel),
                        i16::from(key),
                        f32::from(velocity) / 127.0,
                        note_id,
                    )
                }
            })
            .unwrap_or(false)
    }

    pub fn poly_pressure(
        &mut self,
        sample_offset: i32,
        channel: u8,
        key: u8,
        pressure: u8,
    ) -> bool {
        let cell = unsafe {
            // SAFETY: the owner keeps this stable cell alive for the lease lifetime.
            self.cell.as_ref()
        };
        cell.access
            .try_access(|| unsafe {
                // SAFETY: the same audio access guard as process_block excludes UI mutation.
                (&mut *cell.processor.get()).queue_poly_pressure(
                    sample_offset,
                    i16::from(channel),
                    i16::from(key),
                    f32::from(pressure) / 127.0,
                )
            })
            .unwrap_or(false)
    }

    pub fn sysex(&mut self, sample_offset: i32, bytes: &[u8]) -> bool {
        let cell = unsafe {
            // SAFETY: the owner keeps this stable cell alive for the lease lifetime.
            self.cell.as_ref()
        };
        cell.access
            .try_access(|| unsafe {
                // SAFETY: the same audio access guard as process_block excludes UI mutation.
                (&mut *cell.processor.get()).queue_sysex(sample_offset, bytes)
            })
            .unwrap_or(false)
    }

    pub fn control_change(
        &mut self,
        sample_offset: i32,
        channel: u8,
        controller: u8,
        value: u8,
    ) -> bool {
        self.mapped_parameter(
            sample_offset,
            channel,
            usize::from(controller),
            f64::from(value) / 127.0,
        )
    }

    pub fn channel_pressure(&mut self, sample_offset: i32, channel: u8, pressure: u8) -> bool {
        self.mapped_parameter(
            sample_offset,
            channel,
            MIDI_AFTERTOUCH,
            f64::from(pressure) / 127.0,
        )
    }

    pub fn pitch_bend(&mut self, sample_offset: i32, channel: u8, bend: u16) -> bool {
        self.mapped_parameter(
            sample_offset,
            channel,
            MIDI_PITCH_BEND,
            f64::from(bend.min(16_383)) / 16_383.0,
        )
    }

    pub fn program_change(&mut self, sample_offset: i32, channel: u8, program: u8) -> bool {
        self.mapped_parameter(
            sample_offset,
            channel,
            MIDI_PROGRAM_CHANGE,
            f64::from(program) / 127.0,
        )
    }

    fn mapped_parameter(
        &mut self,
        sample_offset: i32,
        channel: u8,
        controller: usize,
        value: f64,
    ) -> bool {
        let Some(parameter_id) = self.midi_mapping.parameter(channel, controller) else {
            return false;
        };
        let cell = unsafe {
            // SAFETY: the owner keeps this stable cell alive for the lease lifetime.
            self.cell.as_ref()
        };
        cell.access
            .try_access(|| unsafe {
                // SAFETY: the same audio access guard as process_block excludes UI mutation.
                (&mut *cell.processor.get()).queue_parameter_change(
                    sample_offset,
                    parameter_id,
                    value,
                )
            })
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::{ProcessOutcome, ProcessingAccess};
    use heron_audio_plugin::{
        AudioPluginProcessor, AudioPluginProcessorHandle, AudioPortToken, ProcessContext,
        SidechainSource,
    };
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[derive(Clone)]
    struct GuardedProcessor {
        access: Arc<ProcessingAccess>,
        calls: Arc<AtomicUsize>,
    }

    impl AudioPluginProcessor for GuardedProcessor {
        fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
            Box::new(self.clone())
        }

        fn process_block(
            &mut self,
            frames: &mut [[f32; 2]],
            _sidechains: &dyn SidechainSource,
            _context: &ProcessContext,
        ) -> ProcessOutcome {
            // Exercise the same pause and ownership guard used by ProcessorLease.
            self.access.process(|| {
                self.calls.fetch_add(1, Ordering::Relaxed);
                frames.fill([0.5, 0.25]);
                ProcessOutcome::Processed
            })
        }
    }

    struct NoSidechains;

    impl SidechainSource for NoSidechains {
        fn frames(&self, _port: AudioPortToken) -> Option<&[[f32; 2]]> {
            None
        }
    }

    fn context() -> ProcessContext {
        ProcessContext {
            project_time_samples: 0,
            continuous_time_samples: 0,
            steady_time_samples: 0,
            project_time_quarters: 0.0,
            bar_position_quarters: 0.0,
            tempo: 120.0,
            time_signature_numerator: 4,
            time_signature_denominator: 4,
            playing: false,
            recording: false,
            loop_active: false,
            loop_start_quarters: 0.0,
            loop_end_quarters: 0.0,
        }
    }

    #[test]
    fn paused_and_busy_leases_resume_without_latching_a_plugin_failure() {
        let access = Arc::new(ProcessingAccess::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let mut processor = AudioPluginProcessorHandle::new(GuardedProcessor {
            access: Arc::clone(&access),
            calls: Arc::clone(&calls),
        });
        let observer = processor.clone();
        let mut frames = [[1.0, 2.0]];

        access.with_paused(|| {
            assert!(!processor.process_block(&mut frames, &NoSidechains, &context()));
        });
        access.process(|| {
            assert!(!processor.process_block(&mut frames, &NoSidechains, &context()));
            ProcessOutcome::Processed
        });
        assert_eq!(frames, [[1.0, 2.0]]);
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        assert_eq!(observer.take_unreported_process_failure(), None);

        assert!(processor.process_block(&mut frames, &NoSidechains, &context()));
        assert_eq!(frames, [[0.5, 0.25]]);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        assert_eq!(observer.take_unreported_process_failure(), None);
    }

    #[test]
    fn failed_recovery_stays_paused_across_queries_until_an_explicit_recovery_succeeds() {
        let access = ProcessingAccess::default();
        assert_eq!(
            access.with_paused_recovery(|| Err::<(), _>("restore rejected")),
            Err("restore rejected")
        );
        access.with_paused(|| {});
        assert_eq!(
            access.with_paused_policy(|| Ok::<_, ()>(()), |_| true),
            Ok(())
        );
        assert_eq!(
            access.process(|| panic!("an uncertain processor must remain unavailable")),
            ProcessOutcome::TemporarilyUnavailable
        );

        assert_eq!(access.with_paused_recovery(|| Ok::<_, ()>(())), Ok(()));
        assert_eq!(
            access.with_paused_policy(|| Err::<(), _>("read rejected"), |_| false),
            Err("read rejected")
        );
        assert_eq!(
            access.process(|| ProcessOutcome::Processed),
            ProcessOutcome::Processed
        );

        assert_eq!(
            access.with_paused_policy(|| Err::<(), _>("flush uncertain"), |_| true),
            Err("flush uncertain")
        );
        assert_eq!(
            access.try_access(|| panic!("MIDI must not enter an uncertain processor")),
            None::<()>
        );
        assert_eq!(access.with_paused_recovery(|| Ok::<_, ()>(())), Ok(()));
        assert_eq!(access.try_access(|| true), Some(true));
    }
}
