use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};

#[cfg(test)]
use heron_audio_plugin::ProcessOutcome;

use crate::{HostError, HostResult};

const MUTATION: u8 = 1;
const RESTART: u8 = 2;
const PAIR_STATE: u8 = 4;
const PAIR_MUTATION: u8 = 8;

#[derive(Default)]
pub(super) struct ProcessingAccess {
    pauses: AtomicUsize,
    quarantine: AtomicU8,
    processing: AtomicBool,
}

struct PauseScope<'a>(&'a ProcessingAccess);

pub(super) struct ProcessingClaim<'a>(&'a ProcessingAccess);

impl Drop for PauseScope<'_> {
    fn drop(&mut self) {
        self.0.pauses.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Drop for ProcessingClaim<'_> {
    fn drop(&mut self) {
        self.0.processing.store(false, Ordering::SeqCst);
    }
}

impl ProcessingAccess {
    fn pause(&self) -> PauseScope<'_> {
        self.pauses.fetch_add(1, Ordering::SeqCst);
        while self.processing.load(Ordering::SeqCst) {
            std::hint::spin_loop();
        }
        PauseScope(self)
    }

    pub(super) fn with_paused<T>(&self, action: impl FnOnce() -> T) -> T {
        let _pause = self.pause();
        action()
    }

    pub(super) fn with_paused_recovery<T, E>(
        &self,
        action: impl FnOnce() -> Result<T, E>,
    ) -> Result<T, E> {
        let _pause = self.pause();
        let result = action();
        if result.is_ok() {
            // State restore and reactivation validate local state and lifecycle,
            // but cannot reconcile a mismatch between two owners' bus overrides.
            self.quarantine
                .fetch_and(!(MUTATION | RESTART), Ordering::SeqCst);
        } else {
            self.quarantine.fetch_or(MUTATION, Ordering::SeqCst);
        }
        result
    }

    pub(super) fn with_paused_policy<T, E>(
        &self,
        action: impl FnOnce() -> Result<T, E>,
        quarantine: impl FnOnce(&E) -> bool,
    ) -> Result<T, E> {
        let _pause = self.pause();
        let result = action();
        if result.as_ref().err().is_some_and(quarantine) {
            self.quarantine.fetch_or(MUTATION, Ordering::SeqCst);
        }
        result
    }

    pub(super) fn with_paused_restart<T>(
        &self,
        action: impl FnOnce() -> HostResult<T>,
    ) -> HostResult<T> {
        let _pause = self.pause();
        let result = action();
        match &result {
            Ok(_) => {
                self.quarantine.fetch_and(!RESTART, Ordering::SeqCst);
            }
            Err(error) if uncertain(error) => {
                self.quarantine.fetch_or(RESTART, Ordering::SeqCst);
            }
            Err(_) => {}
        }
        result
    }

    pub(super) fn with_pair_transaction<T>(
        &self,
        secondary: Option<&Self>,
        recovery: bool,
        action: impl FnOnce() -> HostResult<T>,
    ) -> HostResult<T> {
        let _primary_pause = self.pause();
        let _secondary_pause = secondary.map(Self::pause);
        let primary_before = self.quarantine.load(Ordering::SeqCst);
        let secondary_before = secondary.map(|lane| lane.quarantine.load(Ordering::SeqCst));
        let result = action();
        let resolve = |lane: &Self, before: u8| {
            let reasons = match &result {
                Ok(_) if recovery => before & PAIR_MUTATION,
                Ok(_) => (before & !RESTART) | lane.quarantine.load(Ordering::SeqCst),
                Err(error) if uncertain(error) => {
                    before
                        | lane.quarantine.load(Ordering::SeqCst)
                        | if secondary.is_none() {
                            MUTATION
                        } else if recovery {
                            PAIR_STATE
                        } else {
                            PAIR_MUTATION
                        }
                }
                // A fully restored checkpoint rejects the operation without
                // discarding any quarantine that preceded the transaction.
                Err(_) => before,
            };
            lane.quarantine.store(reasons, Ordering::SeqCst);
        };
        resolve(self, primary_before);
        if let Some((lane, before)) = secondary.zip(secondary_before) {
            resolve(lane, before);
        }
        result
    }

    pub(super) fn try_claim(&self) -> Option<ProcessingClaim<'_>> {
        // All three atomics share a sequentially consistent order. Either the
        // callback sees a UI pause, or the UI sees its claim and drains it.
        if self.is_paused() || self.processing.swap(true, Ordering::SeqCst) {
            return None;
        }
        let claim = ProcessingClaim(self);
        if self.is_paused() {
            return None;
        }
        Some(claim)
    }

    fn is_paused(&self) -> bool {
        self.pauses.load(Ordering::SeqCst) != 0 || self.quarantine.load(Ordering::SeqCst) != 0
    }

    pub(super) fn try_access<T>(&self, action: impl FnOnce() -> T) -> Option<T> {
        let _claim = self.try_claim()?;
        Some(action())
    }

    #[cfg(test)]
    pub(super) fn process(&self, action: impl FnOnce() -> ProcessOutcome) -> ProcessOutcome {
        self.try_access(action)
            .unwrap_or(ProcessOutcome::TemporarilyUnavailable)
    }
}

fn uncertain(error: &HostError) -> bool {
    matches!(
        error,
        HostError::CommitUncertain { .. } | HostError::RecoveryFailed { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processor_handle::{ProcessorChannel, process_channels};
    use std::{cell::Cell, sync::mpsc, time::Duration};

    fn rejection() -> HostError {
        HostError::Operation {
            operation: "controlled native setter",
            result: 1,
        }
    }

    fn uncertain_restart() -> HostError {
        HostError::CommitUncertain {
            operation: "restart plug-in processing",
            source: Box::new(rejection()),
        }
    }

    fn assert_unavailable(access: &ProcessingAccess) {
        assert_eq!(access.try_access(|| true), None);
    }

    #[test]
    fn successful_restart_resolves_only_its_own_quarantine() {
        let access = ProcessingAccess::default();
        assert!(
            access
                .with_paused_restart(|| Err::<(), _>(uncertain_restart()))
                .is_err()
        );
        assert_unavailable(&access);
        assert!(
            access
                .with_paused_restart(|| Err::<(), _>(HostError::InvalidArgument {
                    operation: "bus address",
                }))
                .is_err()
        );
        assert_unavailable(&access);
        access.with_paused_restart(|| Ok(())).unwrap();
        assert_eq!(access.try_access(|| 7), Some(7));

        assert!(
            access
                .with_paused_recovery(|| Err::<(), _>(rejection()))
                .is_err()
        );
        access.with_paused_restart(|| Ok(())).unwrap();
        assert_unavailable(&access);
        access
            .with_paused_recovery(|| Ok::<_, HostError>(()))
            .unwrap();
        assert_eq!(access.try_access(|| 7), Some(7));
    }

    #[test]
    fn nested_recovery_cannot_release_a_scope_or_erase_a_failed_mutation() {
        let access = ProcessingAccess::default();
        access.with_paused(|| {
            access
                .with_paused_recovery(|| Ok::<_, HostError>(()))
                .unwrap();
            assert_unavailable(&access);
            access.with_paused(|| {
                assert!(
                    access
                        .with_paused_policy(|| Err::<(), _>(rejection()), |_| true)
                        .is_err()
                );
            });
            assert_unavailable(&access);
        });
        assert_unavailable(&access);
        access
            .with_paused_recovery(|| Ok::<_, HostError>(()))
            .unwrap();
        assert_eq!(access.try_access(|| true), Some(true));
    }

    #[test]
    fn successful_paired_bus_restart_resolves_lane_restart_failures() {
        let primary = ProcessingAccess::default();
        let secondary = ProcessingAccess::default();
        for lane in [&primary, &secondary] {
            assert!(
                lane.with_paused_restart(|| Err::<(), _>(uncertain_restart()))
                    .is_err()
            );
        }
        primary
            .with_pair_transaction(Some(&secondary), false, || {
                primary.with_paused_restart(|| Ok(()))?;
                secondary.with_paused_restart(|| Ok(()))
            })
            .unwrap();
        assert_eq!(primary.try_access(|| true), Some(true));
        assert_eq!(secondary.try_access(|| true), Some(true));
    }

    #[test]
    fn failed_recovery_of_either_lane_keeps_both_paused_until_paired_recovery() {
        for failed_lane in 0..2 {
            let primary = ProcessingAccess::default();
            let secondary = ProcessingAccess::default();
            let result = primary.with_pair_transaction(Some(&secondary), true, || {
                let lanes = [&primary, &secondary];
                for (index, lane) in lanes.into_iter().enumerate() {
                    let _ = lane.with_paused_recovery(|| {
                        if index == failed_lane {
                            Err(rejection())
                        } else {
                            Ok(())
                        }
                    });
                    // Even a successful lane restore cannot bypass the pair scope.
                    assert_unavailable(&primary);
                    assert_unavailable(&secondary);
                }
                Err::<(), _>(HostError::RecoveryFailed {
                    operation: "restore dual-mono editor state",
                    source: Box::new(rejection()),
                    recovery: Box::new(rejection()),
                })
            });
            assert!(matches!(result, Err(HostError::RecoveryFailed { .. })));
            assert_unavailable(&primary);
            assert_unavailable(&secondary);
            primary.with_paused_restart(|| Ok(())).unwrap();
            secondary.with_paused_restart(|| Ok(())).unwrap();
            assert_unavailable(&primary);
            assert_unavailable(&secondary);
            primary
                .with_pair_transaction(Some(&secondary), true, || {
                    primary.with_paused_recovery(|| Ok::<_, HostError>(()))?;
                    secondary.with_paused_recovery(|| Ok::<_, HostError>(()))
                })
                .unwrap();
            assert_eq!(primary.try_access(|| true), Some(true));
            assert_eq!(secondary.try_access(|| true), Some(true));
        }
    }

    #[test]
    fn complete_rollback_restores_the_prior_pair_quarantine() {
        let primary = ProcessingAccess::default();
        let secondary = ProcessingAccess::default();
        for already_uncertain in [false, true] {
            if already_uncertain {
                assert!(
                    primary
                        .with_paused_restart(|| Err::<(), _>(uncertain_restart()))
                        .is_err()
                );
            }
            let result = primary.with_pair_transaction(Some(&secondary), true, || {
                assert!(
                    secondary
                        .with_paused_recovery(|| Err::<(), _>(rejection()))
                        .is_err()
                );
                primary.with_paused_recovery(|| Ok::<_, HostError>(()))?;
                secondary.with_paused_recovery(|| Ok::<_, HostError>(()))?;
                Err::<(), _>(rejection())
            });
            assert!(matches!(result, Err(HostError::Operation { .. })));
            assert_eq!(
                primary.try_access(|| true),
                (!already_uncertain).then_some(true)
            );
            assert_eq!(secondary.try_access(|| true), Some(true));
        }
    }

    #[test]
    fn paired_bus_mismatch_survives_local_restart_and_unrelated_state_restore() {
        let primary = ProcessingAccess::default();
        let secondary = ProcessingAccess::default();
        let result = primary.with_pair_transaction(Some(&secondary), false, || {
            primary.with_paused_restart(|| Ok(()))?;
            Err::<(), _>(HostError::CommitUncertain {
                operation: "dual-mono bus activation",
                source: Box::new(rejection()),
            })
        });
        assert!(matches!(result, Err(HostError::CommitUncertain { .. })));
        assert_unavailable(&primary);
        assert_unavailable(&secondary);
        primary.with_paused_restart(|| Ok(())).unwrap();
        secondary.with_paused_restart(|| Ok(())).unwrap();
        primary
            .with_pair_transaction(Some(&secondary), true, || {
                primary.with_paused_recovery(|| Ok::<_, HostError>(()))?;
                secondary.with_paused_recovery(|| Ok::<_, HostError>(()))
            })
            .unwrap();
        assert_unavailable(&primary);
        assert_unavailable(&secondary);
    }

    #[test]
    fn paused_or_busy_secondary_prevents_either_lane_from_advancing() {
        let primary = ProcessingAccess::default();
        let secondary = ProcessingAccess::default();
        let calls = Cell::new(0);
        let run = || {
            process_channels(
                true,
                |channel| match channel {
                    ProcessorChannel::Left => primary.try_claim(),
                    ProcessorChannel::Right => secondary.try_claim(),
                    ProcessorChannel::Stereo => unreachable!(),
                },
                |_, _| {
                    assert_unavailable(&primary);
                    assert_unavailable(&secondary);
                    calls.set(calls.get() + 1);
                    ProcessOutcome::Processed
                },
            )
        };
        secondary.with_paused(|| assert_eq!(run(), ProcessOutcome::TemporarilyUnavailable));
        let busy = secondary.try_claim().unwrap();
        assert_eq!(run(), ProcessOutcome::TemporarilyUnavailable);
        assert_eq!(calls.get(), 0);
        assert_eq!(primary.try_access(|| true), Some(true));
        drop(busy);
        assert_eq!(run(), ProcessOutcome::Processed);
        assert_eq!(calls.get(), 2);
        assert_eq!(primary.try_access(|| true), Some(true));
        assert_eq!(secondary.try_access(|| true), Some(true));
    }

    #[test]
    fn primary_ui_pause_drains_the_entire_dual_mono_block() {
        let primary = ProcessingAccess::default();
        let secondary = ProcessingAccess::default();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let (mutated_tx, mutated_rx) = mpsc::channel();
        std::thread::scope(|scope| {
            let primary_ref = &primary;
            let secondary_ref = &secondary;
            let audio = scope.spawn(move || {
                process_channels(
                    true,
                    |channel| match channel {
                        ProcessorChannel::Left => primary_ref.try_claim(),
                        ProcessorChannel::Right => secondary_ref.try_claim(),
                        ProcessorChannel::Stereo => unreachable!(),
                    },
                    |channel, _| {
                        if channel == ProcessorChannel::Right {
                            entered_tx.send(()).unwrap();
                            finish_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                        }
                        ProcessOutcome::Processed
                    },
                )
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let ui = scope.spawn(|| primary.with_paused(|| mutated_tx.send(()).unwrap()));
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            while primary.pauses.load(Ordering::SeqCst) == 0 {
                assert!(std::time::Instant::now() < deadline);
                std::thread::yield_now();
            }
            assert_eq!(mutated_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
            finish_tx.send(()).unwrap();
            assert_eq!(audio.join().unwrap(), ProcessOutcome::Processed);
            ui.join().unwrap();
            mutated_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
    }
}
