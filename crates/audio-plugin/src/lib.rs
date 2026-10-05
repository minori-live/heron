//! Format-neutral real-time audio plug-in interfaces.
//!
//! Format implementations own their ABI and control-thread objects. The audio
//! engine only receives cloneable processor endpoints defined by this crate.

use std::{
    collections::HashMap,
    hash::Hash,
    sync::{
        Arc,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
};

/// A recoverable processing failure observed at the format-neutral boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginProcessFailure {
    Rejected,
    InvalidOutput,
    /// A format-native processing call returned a rejection code.
    NativeRejected(i32),
}

/// Result of one real-time processing attempt.
///
/// Host-owned pauses and a busy endpoint do not imply that a plug-in failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProcessOutcome {
    Processed,
    TemporarilyUnavailable,
    Failed(PluginProcessFailure),
}

impl ProcessOutcome {
    #[must_use]
    pub const fn is_processed(self) -> bool {
        matches!(self, Self::Processed)
    }
}

/// Stable runtime context captured with a processing failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PluginProcessFailureReport {
    pub failure: PluginProcessFailure,
    pub instance_generation: u32,
    pub graph_revision: u64,
}

impl PluginProcessFailure {
    const fn from_state(value: u64) -> Option<Self> {
        match value & 0x7f {
            1 => Some(Self::Rejected),
            2 => Some(Self::InvalidOutput),
            3 => Some(Self::NativeRejected((value >> 32) as u32 as i32)),
            _ => None,
        }
    }

    const fn state(self) -> u64 {
        match self {
            Self::Rejected => 1,
            Self::InvalidOutput => 2,
            Self::NativeRejected(result) => (result as u32 as u64) << 32 | 3,
        }
    }
}

struct PluginProcessFailureState {
    // Publish the category and native result together so every clone observes
    // the same first failure, even when reporting races with another caller.
    failure: AtomicU64,
    instance_generation: AtomicU32,
    graph_revision: AtomicU64,
}

impl PluginProcessFailureState {
    fn new() -> Self {
        Self {
            failure: AtomicU64::new(0),
            instance_generation: AtomicU32::new(1),
            graph_revision: AtomicU64::new(0),
        }
    }

    fn mark(&self, failure: PluginProcessFailure) {
        let _ =
            self.failure
                .compare_exchange(0, failure.state(), Ordering::Release, Ordering::Relaxed);
    }

    fn failure(&self) -> Option<PluginProcessFailure> {
        PluginProcessFailure::from_state(self.failure.load(Ordering::Acquire))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct AudioPortToken(u32);

impl AudioPortToken {
    /// Creates an instance-local token.
    #[must_use]
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    /// Returns the dense numeric representation used by real-time adapters.
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

/// A dense parameter token resolved while a plug-in instance is prepared.
///
/// Tokens are generation-scoped and are safe to place in the bounded direct
/// parameter queue. Stable parameter keys remain outside the audio callback.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct ParameterToken(u32);

impl ParameterToken {
    /// Creates a generation-scoped token.
    #[must_use]
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    /// Returns the dense numeric representation used by real-time adapters.
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

/// Per-instance translation between stable format-native parameter identities
/// and dense generation-scoped real-time tokens.
#[derive(Clone, Debug)]
pub struct ParameterTokenMap<NativeId> {
    token_to_native: HashMap<u32, NativeId>,
    native_to_token: HashMap<NativeId, u32>,
}

impl<NativeId> ParameterTokenMap<NativeId>
where
    NativeId: Copy + Eq + Hash + Ord,
{
    /// Assigns deterministic dense tokens starting at one. Returns `None` only
    /// when the native identity count exceeds the `u32` token space.
    pub fn from_native_ids(ids: impl IntoIterator<Item = NativeId>) -> Option<Self> {
        let mut ids = ids.into_iter().collect::<Vec<_>>();
        ids.sort_unstable();
        ids.dedup();
        let mut token_to_native = HashMap::with_capacity(ids.len());
        let mut native_to_token = HashMap::with_capacity(ids.len());
        for (index, native_id) in ids.into_iter().enumerate() {
            let token = u32::try_from(index).ok()?.checked_add(1)?;
            token_to_native.insert(token, native_id);
            native_to_token.insert(native_id, token);
        }
        Some(Self {
            token_to_native,
            native_to_token,
        })
    }

    #[must_use]
    pub fn native_id(&self, token: u32) -> Option<NativeId> {
        self.token_to_native.get(&token).copied()
    }

    #[must_use]
    pub fn token(&self, native_id: NativeId) -> Option<u32> {
        self.native_to_token.get(&native_id).copied()
    }
}

/// Transport and musical timing information at the first frame of a block.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProcessContext {
    pub project_time_samples: i64,
    pub continuous_time_samples: i64,
    pub steady_time_samples: i64,
    pub project_time_quarters: f64,
    pub bar_position_quarters: f64,
    pub tempo: f64,
    pub time_signature_numerator: i32,
    pub time_signature_denominator: i32,
    pub playing: bool,
    pub recording: bool,
    pub loop_active: bool,
    pub loop_start_quarters: f64,
    pub loop_end_quarters: f64,
}

/// Read-only sidechain blocks made available for one processing call.
pub trait SidechainSource {
    fn frames(&self, port: AudioPortToken) -> Option<&[[f32; 2]]>;
}

/// Object-safe, allocation-free-after-construction plug-in processor endpoint.
///
/// Implementations are transferred between graph generations, but a concrete
/// endpoint is called by only one audio thread at a time.
pub trait AudioPluginProcessor: Send {
    fn clone_box(&self) -> Box<dyn AudioPluginProcessor>;

    /// Only `Failed` records a sticky instance failure. Temporary host-owned
    /// unavailability emits dry audio or silence for this block and can resume.
    fn process_block(
        &mut self,
        frames: &mut [[f32; 2]],
        sidechains: &dyn SidechainSource,
        context: &ProcessContext,
    ) -> ProcessOutcome;

    /// Balances format-specific audio-thread lifecycle before a graph endpoint
    /// is returned to the control thread. Must not allocate or block.
    fn retire(&mut self) {}

    fn note_on(
        &mut self,
        _offset: usize,
        _channel: u8,
        _key: u8,
        _velocity: u8,
        _note_id: i32,
    ) -> bool {
        false
    }

    fn note_off(
        &mut self,
        _offset: usize,
        _channel: u8,
        _key: u8,
        _velocity: u8,
        _note_id: i32,
    ) -> bool {
        false
    }

    fn poly_pressure(&mut self, _offset: usize, _channel: u8, _key: u8, _pressure: u8) -> bool {
        false
    }

    fn control_change(
        &mut self,
        _offset: usize,
        _channel: u8,
        _controller: u8,
        _value: u8,
    ) -> bool {
        false
    }

    fn pitch_bend(&mut self, _offset: usize, _channel: u8, _value: u16) -> bool {
        false
    }

    fn channel_pressure(&mut self, _offset: usize, _channel: u8, _pressure: u8) -> bool {
        false
    }

    fn program_change(&mut self, _offset: usize, _channel: u8, _program: u8) -> bool {
        false
    }

    fn sysex(&mut self, _offset: usize, _bytes: &[u8]) -> bool {
        false
    }

    /// Queues one plain-value parameter event for the next process block.
    fn parameter(&mut self, _offset: usize, _token: ParameterToken, _value: f64) -> bool {
        false
    }
}

/// Cloneable type-erased processor handle stored by render graphs.
pub struct AudioPluginProcessorHandle {
    inner: Box<dyn AudioPluginProcessor>,
    duplicate_mono_output: bool,
    failure: Arc<PluginProcessFailureState>,
}

impl AudioPluginProcessorHandle {
    /// Erases one format-specific real-time endpoint.
    #[must_use]
    pub fn new(processor: impl AudioPluginProcessor + 'static) -> Self {
        Self {
            inner: Box::new(processor),
            duplicate_mono_output: false,
            failure: Arc::new(PluginProcessFailureState::new()),
        }
    }

    /// Duplicates the processed mono left channel into the right channel.
    #[must_use]
    pub fn with_mono_output_duplication(mut self) -> Self {
        self.duplicate_mono_output = true;
        self
    }

    pub fn process_block(
        &mut self,
        frames: &mut [[f32; 2]],
        sidechains: &dyn SidechainSource,
        context: &ProcessContext,
    ) -> bool {
        if self.failure.failure().is_some() {
            return false;
        }
        match self.inner.process_block(frames, sidechains, context) {
            ProcessOutcome::Processed => {}
            ProcessOutcome::TemporarilyUnavailable => return false,
            ProcessOutcome::Failed(failure) => {
                self.failure.mark(failure);
                return false;
            }
        }
        if frames
            .iter()
            .any(|frame| !frame[0].is_finite() || !frame[1].is_finite())
        {
            self.failure.mark(PluginProcessFailure::InvalidOutput);
            return false;
        }
        if self.duplicate_mono_output {
            for frame in frames {
                frame[1] = frame[0];
            }
        }
        true
    }

    /// Selects the active runtime generation before entering third-party code.
    /// A sticky failure keeps the context captured by its first transition.
    pub fn set_failure_context(&self, instance_generation: u32, graph_revision: u64) {
        if self.failure.failure.load(Ordering::Acquire) != 0 {
            return;
        }
        self.failure
            .instance_generation
            .store(instance_generation, Ordering::Relaxed);
        self.failure
            .graph_revision
            .store(graph_revision, Ordering::Relaxed);
    }

    /// Returns the first processing failure once across every clone of this
    /// handle. The audio thread only sets atomics; control code owns reporting.
    pub fn take_unreported_process_failure(&self) -> Option<PluginProcessFailureReport> {
        let mut state = self.failure.failure.load(Ordering::Acquire);
        loop {
            if state == 0 || state & 0x80 != 0 {
                return None;
            }
            match self.failure.failure.compare_exchange_weak(
                state,
                state | 0x80,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    return PluginProcessFailure::from_state(state).map(|failure| {
                        PluginProcessFailureReport {
                            failure,
                            instance_generation: self
                                .failure
                                .instance_generation
                                .load(Ordering::Relaxed),
                            graph_revision: self.failure.graph_revision.load(Ordering::Relaxed),
                        }
                    });
                }
                Err(current) => state = current,
            }
        }
    }

    /// Makes a previously taken failure eligible for reporting again when the
    /// bounded host-event queue could not accept it.
    pub fn make_process_failure_reportable(&self) {
        self.failure.failure.fetch_and(!0x80, Ordering::Release);
    }

    /// Re-arms a processor after an explicit user retry. This does not rebuild
    /// or restore the native instance; callers must use it only for a returned
    /// processing failure where the instance remains owned and valid.
    pub fn retry_after_process_failure(&self) -> bool {
        self.failure.failure.swap(0, Ordering::AcqRel) != 0
    }

    pub fn retire(&mut self) {
        self.inner.retire();
    }

    pub fn note_on(
        &mut self,
        offset: usize,
        channel: u8,
        key: u8,
        velocity: u8,
        note_id: i32,
    ) -> bool {
        self.inner.note_on(offset, channel, key, velocity, note_id)
    }

    pub fn note_off(
        &mut self,
        offset: usize,
        channel: u8,
        key: u8,
        velocity: u8,
        note_id: i32,
    ) -> bool {
        self.inner.note_off(offset, channel, key, velocity, note_id)
    }

    pub fn poly_pressure(&mut self, offset: usize, channel: u8, key: u8, pressure: u8) -> bool {
        self.inner.poly_pressure(offset, channel, key, pressure)
    }

    pub fn control_change(
        &mut self,
        offset: usize,
        channel: u8,
        controller: u8,
        value: u8,
    ) -> bool {
        self.inner
            .control_change(offset, channel, controller, value)
    }

    pub fn pitch_bend(&mut self, offset: usize, channel: u8, value: u16) -> bool {
        self.inner.pitch_bend(offset, channel, value)
    }

    pub fn channel_pressure(&mut self, offset: usize, channel: u8, pressure: u8) -> bool {
        self.inner.channel_pressure(offset, channel, pressure)
    }

    pub fn program_change(&mut self, offset: usize, channel: u8, program: u8) -> bool {
        self.inner.program_change(offset, channel, program)
    }

    pub fn sysex(&mut self, offset: usize, bytes: &[u8]) -> bool {
        self.inner.sysex(offset, bytes)
    }

    pub fn parameter(&mut self, offset: usize, token: ParameterToken, value: f64) -> bool {
        self.inner.parameter(offset, token, value)
    }
}

impl Clone for AudioPluginProcessorHandle {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone_box(),
            duplicate_mono_output: self.duplicate_mono_output,
            failure: Arc::clone(&self.failure),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AudioPluginProcessor, AudioPluginProcessorHandle, AudioPortToken, ParameterTokenMap,
        PluginProcessFailure, ProcessContext, ProcessOutcome, SidechainSource,
    };

    #[derive(Clone)]
    struct MonoProcessor;

    impl AudioPluginProcessor for MonoProcessor {
        fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
            Box::new(self.clone())
        }

        fn process_block(
            &mut self,
            frames: &mut [[f32; 2]],
            _sidechains: &dyn SidechainSource,
            _context: &ProcessContext,
        ) -> ProcessOutcome {
            for frame in frames {
                frame[0] *= 2.0;
                frame[1] = 0.0;
            }
            ProcessOutcome::Processed
        }
    }

    #[derive(Clone)]
    struct UnprocessedMonoProcessor;

    impl AudioPluginProcessor for UnprocessedMonoProcessor {
        fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
            Box::new(self.clone())
        }

        fn process_block(
            &mut self,
            frames: &mut [[f32; 2]],
            _sidechains: &dyn SidechainSource,
            _context: &ProcessContext,
        ) -> ProcessOutcome {
            frames[0][0] = 4.0;
            ProcessOutcome::Failed(PluginProcessFailure::Rejected)
        }
    }

    struct NoSidechains;

    #[derive(Clone)]
    struct NativeFailureProcessor(i32);

    impl AudioPluginProcessor for NativeFailureProcessor {
        fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
            Box::new(self.clone())
        }

        fn process_block(
            &mut self,
            _frames: &mut [[f32; 2]],
            _sidechains: &dyn SidechainSource,
            _context: &ProcessContext,
        ) -> ProcessOutcome {
            ProcessOutcome::Failed(PluginProcessFailure::NativeRejected(self.0))
        }
    }

    #[derive(Clone)]
    struct NonFiniteProcessor;

    impl AudioPluginProcessor for NonFiniteProcessor {
        fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
            Box::new(self.clone())
        }

        fn process_block(
            &mut self,
            frames: &mut [[f32; 2]],
            _sidechains: &dyn SidechainSource,
            _context: &ProcessContext,
        ) -> ProcessOutcome {
            frames[0][1] = f32::NAN;
            ProcessOutcome::Processed
        }
    }

    impl SidechainSource for NoSidechains {
        fn frames(&self, _port: AudioPortToken) -> Option<&[[f32; 2]]> {
            None
        }
    }

    fn process_context() -> ProcessContext {
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
    fn parameter_tokens_are_dense_deterministic_and_instance_local() {
        let tokens = ParameterTokenMap::from_native_ids([90_u64, 7, 90, 42]).unwrap();
        assert_eq!(tokens.token(7), Some(1));
        assert_eq!(tokens.token(42), Some(2));
        assert_eq!(tokens.token(90), Some(3));
        assert_eq!(tokens.native_id(2), Some(42));
        assert_eq!(tokens.native_id(0), None);
    }

    #[test]
    fn mono_output_duplication_runs_after_successful_native_processing() {
        let mut processor =
            AudioPluginProcessorHandle::new(MonoProcessor).with_mono_output_duplication();
        let mut frames = [[0.25, 9.0], [-0.5, 9.0]];

        assert!(processor.process_block(&mut frames, &NoSidechains, &process_context()));
        assert_eq!(frames, [[0.5, 0.5], [-1.0, -1.0]]);
    }

    #[test]
    fn mono_output_is_not_duplicated_without_the_host_fallback() {
        let mut processor = AudioPluginProcessorHandle::new(MonoProcessor);
        let mut frames = [[0.25, 9.0]];

        assert!(processor.process_block(&mut frames, &NoSidechains, &process_context()));
        assert_eq!(frames, [[0.5, 0.0]]);
    }

    #[test]
    fn cloned_fallback_does_not_duplicate_an_unprocessed_block() {
        let processor = AudioPluginProcessorHandle::new(UnprocessedMonoProcessor)
            .with_mono_output_duplication();
        let mut cloned = processor.clone();
        let mut frames = [[0.25, 9.0]];

        assert!(!cloned.process_block(&mut frames, &NoSidechains, &process_context()));
        assert_eq!(frames, [[4.0, 9.0]]);
        let report = processor
            .take_unreported_process_failure()
            .expect("the rejected block must be reported");
        assert_eq!(report.failure, PluginProcessFailure::Rejected);
        assert_eq!(report.instance_generation, 1);
        assert_eq!(report.graph_revision, 0);
        assert_eq!(cloned.take_unreported_process_failure(), None);
    }

    #[test]
    fn non_finite_output_fails_the_shared_handle_once() {
        let mut processor = AudioPluginProcessorHandle::new(NonFiniteProcessor);
        let mut cloned = processor.clone();
        let mut frames = [[0.25, 0.5]];

        processor.set_failure_context(7, 11);
        assert!(!processor.process_block(&mut frames, &NoSidechains, &process_context()));
        let report = cloned
            .take_unreported_process_failure()
            .expect("the invalid output must be reported");
        assert_eq!(report.failure, PluginProcessFailure::InvalidOutput);
        assert_eq!(report.instance_generation, 7);
        assert_eq!(report.graph_revision, 11);
        frames = [[1.0, 2.0]];
        assert!(!cloned.process_block(&mut frames, &NoSidechains, &process_context()));
        assert_eq!(frames, [[1.0, 2.0]]);
        assert_eq!(processor.take_unreported_process_failure(), None);
        processor.make_process_failure_reportable();
        assert_eq!(
            cloned
                .take_unreported_process_failure()
                .map(|report| report.failure),
            Some(PluginProcessFailure::InvalidOutput)
        );

        assert!(processor.retry_after_process_failure());
        assert!(!cloned.process_block(&mut frames, &NoSidechains, &process_context()));
        assert_eq!(
            processor
                .take_unreported_process_failure()
                .map(|report| report.failure),
            Some(PluginProcessFailure::InvalidOutput)
        );
    }

    #[test]
    fn native_rejection_keeps_the_first_result_across_clones_and_report_retry() {
        let mut processor = AudioPluginProcessorHandle::new(NativeFailureProcessor(-7));
        let mut cloned = processor.clone();
        let mut frames = [[0.25, 0.5]];
        processor.set_failure_context(7, 11);

        assert!(!processor.process_block(&mut frames, &NoSidechains, &process_context()));
        let report = cloned.take_unreported_process_failure().unwrap();
        assert_eq!(report.failure, PluginProcessFailure::NativeRejected(-7));
        assert_eq!((report.instance_generation, report.graph_revision), (7, 11));
        assert!(!cloned.process_block(&mut frames, &NoSidechains, &process_context()));
        assert_eq!(processor.take_unreported_process_failure(), None);

        cloned.make_process_failure_reportable();
        assert_eq!(processor.take_unreported_process_failure(), Some(report));
        assert!(processor.retry_after_process_failure());
        assert!(!cloned.process_block(&mut frames, &NoSidechains, &process_context()));
        assert_eq!(processor.take_unreported_process_failure(), Some(report));
    }
}
