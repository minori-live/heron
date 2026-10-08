//! One prepared and one retired owner slot. Audio exchanges ownership without
//! locks or destruction; the worker performs FIR planning and all reclamation.

use crate::atomic_config::AtomicConfig;
use heron_dsp_core::eq::{EqConfig, EqProcessor};
use std::{
    ptr,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicPtr, AtomicU32, AtomicU64, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

pub struct Prepared {
    pub generation: u64,
    pub processor: EqProcessor,
    pub response: crate::response::ResponseSnapshot,
}

impl Prepared {
    pub fn new(
        processor: EqProcessor,
        response: crate::response::ResponseSnapshot,
        generation: u64,
    ) -> Self {
        Self {
            generation,
            processor,
            response,
        }
    }

    pub fn process(&mut self, input: [f32; 2]) -> [f32; 2] {
        let filtered = self.processor.process_stereo(input[0], input[1]);
        [
            crate::processor::finite_sample(filtered.0),
            crate::processor::finite_sample(filtered.1),
        ]
    }

    pub fn latency_samples(&self) -> usize {
        self.processor.latency_samples()
    }
    pub fn warmup_samples(&self) -> usize {
        self.processor.latency_samples() * 2 + 512
    }
}

pub struct PreparationLane {
    desired: AtomicConfig,
    active_generation: AtomicU64,
    pending: AtomicPtr<Prepared>,
    retired: AtomicPtr<Prepared>,
    stop: AtomicBool,
    error: AtomicU32,
    error_generation: AtomicU64,
    sample_rate: f64,
}

impl PreparationLane {
    fn new(sample_rate: f64) -> Self {
        Self {
            desired: AtomicConfig::default(),
            active_generation: AtomicU64::new(0),
            pending: AtomicPtr::new(ptr::null_mut()),
            retired: AtomicPtr::new(ptr::null_mut()),
            stop: AtomicBool::new(false),
            error: AtomicU32::new(0),
            error_generation: AtomicU64::new(0),
            sample_rate,
        }
    }

    /// Single audio-thread publisher. The bounded atomic payload permits worker
    /// retries without locking or borrowing the plugin's live parameter store.
    pub fn request(&self, config: &EqConfig, requires_preparation: bool) -> u64 {
        if self.error() != 1 {
            self.error.store(0, Ordering::Release);
        }
        self.desired.publish(config, requires_preparation)
    }

    pub fn generation(&self) -> u64 {
        self.desired.version()
    }
    pub fn error(&self) -> u32 {
        let error = self.error.load(Ordering::Acquire);
        if error == 1 || self.error_generation.load(Ordering::Acquire) == self.generation() {
            error
        } else {
            0
        }
    }
    pub fn can_retire(&self) -> bool {
        self.retired.load(Ordering::Acquire).is_null()
    }
    pub fn retire_staged(&self, staged: &mut Option<Box<Prepared>>) -> bool {
        if !self.can_retire() {
            return false;
        }
        if let Some(staged) = staged.take() {
            self.retired.store(Box::into_raw(staged), Ordering::Release);
        }
        true
    }
    pub fn finish_transition(
        &self,
        active: &mut Option<Box<Prepared>>,
        staged: &mut Option<Box<Prepared>>,
    ) -> bool {
        if !self.can_retire()
            || staged
                .as_ref()
                .is_none_or(|staged| staged.generation != self.generation())
        {
            return false;
        }
        if let Some(previous) = std::mem::replace(active, staged.take()) {
            self.retired
                .store(Box::into_raw(previous), Ordering::Release);
        }
        if let Some(active) = active {
            self.active_generation
                .store(active.generation, Ordering::Release);
        }
        true
    }

    fn read_request(&self) -> Option<(u64, EqConfig, bool)> {
        self.desired.read()
    }

    /// A retired slot must be free before consuming a prepared owner. Never
    /// release the current processor or a stale preparation on the callback.
    pub fn adopt(&self, active: &mut Option<Box<Prepared>>) -> bool {
        if !self.retired.load(Ordering::Acquire).is_null() {
            return false;
        }
        let pending = self.pending.swap(ptr::null_mut(), Ordering::AcqRel);
        if pending.is_null() {
            return false;
        }
        // SAFETY: swap transfers the sole pending Box owner to this thread.
        let prepared = unsafe { Box::from_raw(pending) };
        if prepared.generation != self.generation() {
            self.retired
                .store(Box::into_raw(prepared), Ordering::Release);
            return false;
        }
        if let Some(previous) = active.replace(prepared) {
            self.retired
                .store(Box::into_raw(previous), Ordering::Release);
        }
        true
    }

    fn reclaim_retired(&self) {
        let retired = self.retired.swap(ptr::null_mut(), Ordering::AcqRel);
        if !retired.is_null() {
            // SAFETY: atomic swap returns sole ownership. Only this offcallback
            // worker and Drop call reclaim; worker is joined before Drop.
            drop(unsafe { Box::from_raw(retired) });
        }
    }
}

impl Drop for PreparationLane {
    fn drop(&mut self) {
        self.reclaim_retired();
        let pending = self.pending.swap(ptr::null_mut(), Ordering::AcqRel);
        if !pending.is_null() {
            // SAFETY: no worker or audio callback owns this final Arc anymore.
            drop(unsafe { Box::from_raw(pending) });
        }
    }
}

pub struct PreparationWorker {
    pub lane: Arc<PreparationLane>,
    worker: Option<JoinHandle<()>>,
}

impl PreparationWorker {
    pub fn start(sample_rate: f64) -> Self {
        let lane = Arc::new(PreparationLane::new(sample_rate));
        let shared = Arc::clone(&lane);
        let worker = thread::Builder::new()
            .name("heron-eq-prepare".into())
            .spawn(move || {
                let mut completed = 0;
                while !shared.stop.load(Ordering::Acquire) {
                    shared.reclaim_retired();
                    if let Some((generation, config, prepare)) = shared
                        .read_request()
                        .filter(|(generation, _, _)| *generation != completed)
                    {
                        if !prepare {
                            completed = generation;
                            continue;
                        }
                        if let Ok(processor) = config
                            .validate(shared.sample_rate)
                            .and_then(|()| EqProcessor::prepare(&config, shared.sample_rate))
                        {
                            if generation == shared.generation() {
                                shared.error.store(0, Ordering::Release);
                                let response = crate::response::prepare_response(
                                    &processor,
                                    shared.sample_rate,
                                    generation,
                                );
                                let previous = shared.pending.swap(
                                    Box::into_raw(Box::new(Prepared::new(
                                        processor, response, generation,
                                    ))),
                                    Ordering::AcqRel,
                                );
                                if !previous.is_null() {
                                    // SAFETY: swap transfers sole owner back to the worker.
                                    drop(unsafe { Box::from_raw(previous) });
                                }
                            }
                        } else {
                            // Pair errors with their request generation so even a
                            // newer request racing this store cannot show old failure.
                            shared.error_generation.store(generation, Ordering::Release);
                            shared.error.store(2, Ordering::Release);
                        }
                        completed = generation;
                    }
                    thread::sleep(Duration::from_millis(8));
                }
                shared.reclaim_retired();
            });
        let worker = match worker {
            Ok(worker) => Some(worker),
            Err(_) => {
                lane.error.store(1, Ordering::Release);
                None
            }
        };
        Self { lane, worker }
    }
}

impl Drop for PreparationWorker {
    fn drop(&mut self) {
        self.lane.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use truce_test::assert_realtime_clean;

    fn prepared(config: &EqConfig, generation: u64) -> Box<Prepared> {
        let processor = EqProcessor::prepare(config, 48000.0).expect("valid prepared EQ");
        let response = crate::response::prepare_response(&processor, 48000.0, generation);
        Box::new(Prepared::new(processor, response, generation))
    }

    #[test]
    fn full_retirement_lane_defers_exchange_without_audio_allocation_or_free() {
        let config = EqConfig::default();
        let lane = PreparationLane::new(48000.0);
        let mut active = Some(prepared(&config, 0));
        let mut staged = None;
        let first = lane.request(&config, true);
        lane.pending
            .store(Box::into_raw(prepared(&config, first)), Ordering::Release);
        assert_realtime_clean(|| {
            let _section = truce::rt::RtSection::enter();
            assert!(lane.adopt(&mut staged));
            assert!(lane.finish_transition(&mut active, &mut staged));
        });
        let second = lane.request(&config, true);
        lane.pending
            .store(Box::into_raw(prepared(&config, second)), Ordering::Release);
        assert_realtime_clean(|| {
            let _section = truce::rt::RtSection::enter();
            assert!(!lane.adopt(&mut staged));
        });
        assert_eq!(active.as_ref().unwrap().generation, first);
        lane.reclaim_retired();
        assert_realtime_clean(|| {
            let _section = truce::rt::RtSection::enter();
            assert!(lane.adopt(&mut staged));
        });
        lane.request(&config, false);
        assert_realtime_clean(|| {
            let _section = truce::rt::RtSection::enter();
            assert!(!lane.finish_transition(&mut active, &mut staged));
            assert!(lane.retire_staged(&mut staged));
        });
        assert_eq!(active.as_ref().unwrap().generation, first);
    }

    #[test]
    fn generation_invalidates_prepared_mode_when_user_reverts() {
        let config = EqConfig::default();
        let lane = PreparationLane::new(48000.0);
        let generation = lane.request(&config, true);
        lane.pending.store(
            Box::into_raw(prepared(&config, generation)),
            Ordering::Release,
        );
        lane.request(&config, false);
        let mut staged = None;
        assert_realtime_clean(|| {
            let _section = truce::rt::RtSection::enter();
            assert!(!lane.adopt(&mut staged));
        });
        assert!(staged.is_none());
        assert!(!lane.can_retire());
        assert!(!lane.read_request().unwrap().2);
    }
}
