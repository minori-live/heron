//! One admission barrier and outcome for host operations spanning both mono lanes.

use heron_vst3_host::{HostError, HostResult, HostedPlugin};

use super::{EditorPluginState, failures::recovered_error};

pub(super) fn restore_editor_state(
    primary: &HostedPlugin,
    secondary: Option<&HostedPlugin>,
    state: &EditorPluginState,
) -> HostResult<()> {
    primary
        .with_processing_pair_recovery(secondary, || restore_transaction(primary, secondary, state))
}

pub(super) fn set_bus_active(
    primary: &HostedPlugin,
    secondary: Option<&HostedPlugin>,
    media_type: i32,
    direction: i32,
    index: i32,
    active: bool,
) -> HostResult<()> {
    primary.with_processing_pair_mutation(secondary, || {
        activate_bus(primary, secondary, media_type, direction, index, active)
    })
}

trait TransactionTarget {
    fn save_state(&self) -> HostResult<EditorPluginState>;
    fn restore_state(&self, state: &EditorPluginState) -> HostResult<()>;
    fn set_bus_active(
        &self,
        media_type: i32,
        direction: i32,
        index: i32,
        active: bool,
    ) -> HostResult<()>;
}

impl TransactionTarget for HostedPlugin {
    fn save_state(&self) -> HostResult<EditorPluginState> {
        HostedPlugin::save_state(self).map(|(component_state, controller_state)| {
            EditorPluginState {
                component_state,
                controller_state,
            }
        })
    }

    fn restore_state(&self, state: &EditorPluginState) -> HostResult<()> {
        HostedPlugin::restore_state(self, &state.component_state, &state.controller_state)
    }

    fn set_bus_active(
        &self,
        media_type: i32,
        direction: i32,
        index: i32,
        active: bool,
    ) -> HostResult<()> {
        HostedPlugin::set_bus_active(self, media_type, direction, index, active)
    }
}

fn restore_transaction<T: TransactionTarget>(
    primary: &T,
    secondary: Option<&T>,
    state: &EditorPluginState,
) -> HostResult<()> {
    let primary_before = primary.save_state()?;
    let secondary_before = secondary
        .map(|target| target.save_state().map(|before| (target, before)))
        .transpose()?;
    if let Err(error) = primary.restore_state(state) {
        return Err(match primary.restore_state(&primary_before) {
            Ok(()) => recovered_error(error),
            Err(recovery) => HostError::RecoveryFailed {
                operation: "restore editor state",
                source: Box::new(error),
                recovery: Box::new(recovery),
            },
        });
    }
    if let Some((secondary, secondary_before)) = secondary_before
        && let Err(error) = secondary.restore_state(state)
    {
        // Attempt both rollbacks even when the first one fails. The enclosing
        // pair barrier decides callback admission only after both finish.
        let primary_rollback = primary.restore_state(&primary_before);
        let secondary_rollback = secondary.restore_state(&secondary_before);
        return Err(match (primary_rollback, secondary_rollback) {
            (Ok(()), Ok(())) => recovered_error(error),
            (Err(recovery), _) | (_, Err(recovery)) => HostError::RecoveryFailed {
                operation: "restore dual-mono editor state",
                source: Box::new(error),
                recovery: Box::new(recovery),
            },
        });
    }
    Ok(())
}

fn activate_bus<T: TransactionTarget>(
    primary: &T,
    secondary: Option<&T>,
    media_type: i32,
    direction: i32,
    index: i32,
    active: bool,
) -> HostResult<()> {
    primary.set_bus_active(media_type, direction, index, active)?;
    if let Some(secondary) = secondary
        && let Err(source) = secondary.set_bus_active(media_type, direction, index, active)
    {
        return Err(HostError::CommitUncertain {
            operation: "dual-mono bus activation",
            source: Box::new(source),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        cell::{Cell, RefCell},
        collections::VecDeque,
    };

    use super::*;

    struct ControlledLane {
        state: RefCell<EditorPluginState>,
        save_error: RefCell<Option<HostError>>,
        restore_results: RefCell<VecDeque<bool>>,
        restored_states: RefCell<Vec<EditorPluginState>>,
        bus_active: Cell<bool>,
        bus_error: RefCell<Option<HostError>>,
    }

    fn state(component: u8) -> EditorPluginState {
        EditorPluginState {
            component_state: vec![component],
            controller_state: vec![component + 1],
        }
    }

    impl ControlledLane {
        fn new(component: u8, restore_results: impl IntoIterator<Item = bool>) -> Self {
            Self {
                state: RefCell::new(state(component)),
                save_error: RefCell::new(None),
                restore_results: RefCell::new(restore_results.into_iter().collect()),
                restored_states: RefCell::new(Vec::new()),
                bus_active: Cell::new(false),
                bus_error: RefCell::new(None),
            }
        }
    }

    impl TransactionTarget for ControlledLane {
        fn save_state(&self) -> HostResult<EditorPluginState> {
            if let Some(error) = self.save_error.borrow_mut().take() {
                return Err(error);
            }
            Ok(self.state.borrow().clone())
        }

        fn restore_state(&self, requested: &EditorPluginState) -> HostResult<()> {
            self.restored_states.borrow_mut().push(requested.clone());
            if self
                .restore_results
                .borrow_mut()
                .pop_front()
                .unwrap_or(true)
            {
                *self.state.borrow_mut() = requested.clone();
                Ok(())
            } else {
                // A rejected native mutation may have changed component and UI state.
                *self.state.borrow_mut() = state(200);
                Err(HostError::CommitUncertain {
                    operation: "restore plug-in state",
                    source: Box::new(HostError::Operation {
                        operation: "IComponent::setState",
                        result: 1,
                    }),
                })
            }
        }

        fn set_bus_active(
            &self,
            _media_type: i32,
            _direction: i32,
            _index: i32,
            active: bool,
        ) -> HostResult<()> {
            if let Some(error) = self.bus_error.borrow_mut().take() {
                return Err(error);
            }
            self.bus_active.set(active);
            Ok(())
        }
    }

    #[test]
    fn secondary_snapshot_failure_leaves_both_lane_states_untouched() {
        let primary = ControlledLane::new(10, []);
        let secondary = ControlledLane::new(20, []);
        *secondary.save_error.borrow_mut() = Some(HostError::Operation {
            operation: "IComponent::getState",
            result: 1,
        });

        assert!(matches!(
            restore_transaction(&primary, Some(&secondary), &state(30)),
            Err(HostError::Operation { .. })
        ));
        assert_eq!(*primary.state.borrow(), state(10));
        assert_eq!(*secondary.state.borrow(), state(20));
        assert!(primary.restored_states.borrow().is_empty());
        assert!(secondary.restored_states.borrow().is_empty());
    }

    #[test]
    fn refused_primary_restore_rolls_back_without_changing_secondary() {
        let primary = ControlledLane::new(10, [false, true]);
        let secondary = ControlledLane::new(20, []);

        assert!(matches!(
            restore_transaction(&primary, Some(&secondary), &state(30)),
            Err(HostError::Operation { result: 1, .. })
        ));
        assert_eq!(*primary.state.borrow(), state(10));
        assert_eq!(*secondary.state.borrow(), state(20));
        assert_eq!(*primary.restored_states.borrow(), [state(30), state(10)]);
        assert!(secondary.restored_states.borrow().is_empty());
    }

    #[test]
    fn successful_paired_restore_commits_component_and_controller_state_to_both_lanes() {
        let primary = ControlledLane::new(10, [true]);
        let secondary = ControlledLane::new(20, [true]);

        assert!(restore_transaction(&primary, Some(&secondary), &state(30)).is_ok());
        assert_eq!(*primary.state.borrow(), state(30));
        assert_eq!(*secondary.state.borrow(), state(30));
    }

    #[test]
    fn successful_pair_rollback_returns_known_rejection_and_original_lane_states() {
        let primary = ControlledLane::new(10, [true, true]);
        let secondary = ControlledLane::new(20, [false, true]);

        assert!(matches!(
            restore_transaction(&primary, Some(&secondary), &state(30)),
            Err(HostError::Operation { result: 1, .. })
        ));
        assert_eq!(*primary.state.borrow(), state(10));
        assert_eq!(*secondary.state.borrow(), state(20));
    }

    #[test]
    fn either_lane_rollback_failure_still_attempts_both_and_reports_failed_recovery() {
        for primary_recovers in [false, true] {
            let primary = ControlledLane::new(10, [true, primary_recovers]);
            let secondary = ControlledLane::new(20, [false, !primary_recovers]);

            assert!(matches!(
                restore_transaction(&primary, Some(&secondary), &state(30)),
                Err(HostError::RecoveryFailed { .. })
            ));
            assert_eq!(*primary.restored_states.borrow(), [state(30), state(10)]);
            assert_eq!(*secondary.restored_states.borrow(), [state(30), state(20)]);
            assert_eq!(
                *primary.state.borrow(),
                state(if primary_recovers { 10 } else { 200 })
            );
            assert_eq!(
                *secondary.state.borrow(),
                state(if primary_recovers { 200 } else { 20 })
            );
        }
    }

    #[test]
    fn secondary_bus_validation_failure_after_primary_commit_is_uncertain() {
        let primary = ControlledLane::new(10, []);
        let secondary = ControlledLane::new(20, []);
        *secondary.bus_error.borrow_mut() = Some(HostError::InvalidArgument {
            operation: "VST3 bus index",
        });

        assert!(matches!(
            activate_bus(&primary, Some(&secondary), 0, 0, 1, true),
            Err(HostError::CommitUncertain { source, .. })
                if matches!(*source, HostError::InvalidArgument { .. })
        ));
        assert!(primary.bus_active.get());
        assert!(!secondary.bus_active.get());
    }
}
