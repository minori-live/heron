use super::{HostedPlugin, component_table, controller_table};
use crate::{
    HostError, HostResult,
    results::{ResultCode, controller_sync_result, require_success},
    stream::MemoryStream,
};

impl HostedPlugin {
    pub fn restore_state(&self, component_state: &[u8], controller_state: &[u8]) -> HostResult<()> {
        if self.controller.is_none() && !controller_state.is_empty() {
            return Err(HostError::NullInterface("IEditController::setState"));
        }
        self.processor.with_paused_recovery(|processor| {
            restore_transition(
                processor,
                |processor| processor.deactivate(),
                |processor| {
                    let mut component_stream = MemoryStream::from_slice(component_state);
                    require_success("IComponent::setState", unsafe {
                        // SAFETY: the component is initialized but inactive, and
                        // the stream remains valid for this synchronous call.
                        ((*component_table(processor.component())).set_state)(
                            processor.component().as_ptr(),
                            component_stream.as_interface(),
                        )
                    })?;
                    if let Some(controller) = &self.controller {
                        component_stream.rewind();
                        if let Err(error) =
                            controller_sync_result("IEditController::setComponentState", unsafe {
                                // SAFETY: controller and stream are live on the UI thread.
                                ((*controller_table(controller)).set_component_state)(
                                    controller.as_ptr(),
                                    component_stream.as_interface(),
                                )
                            })
                        {
                            eprintln!("VST3 controller state synchronization rejected: {error}");
                        }
                        if !controller_state.is_empty() {
                            let mut stream = MemoryStream::from_slice(controller_state);
                            require_success("IEditController::setState", unsafe {
                                // SAFETY: controller and stream are live on the UI thread.
                                ((*controller_table(controller)).set_state)(
                                    controller.as_ptr(),
                                    stream.as_interface(),
                                )
                            })?;
                        }
                    }
                    Ok(())
                },
                |processor| processor.activate(),
            )
        })
    }

    pub fn save_state(&self) -> HostResult<(Vec<u8>, Vec<u8>)> {
        let component_state = self.processor.with_paused_policy(
            |processor| {
                processor
                    .flush_parameters()
                    .map_err(|source| HostError::CommitUncertain {
                        operation: "flush parameters before state save",
                        source: Box::new(source),
                    })?;
                let mut stream = MemoryStream::empty();
                require_success("IComponent::getState", unsafe {
                    // SAFETY: component is live, processing is paused, and stream is writable.
                    ((*component_table(processor.component())).get_state)(
                        processor.component().as_ptr(),
                        stream.as_interface(),
                    )
                })?;
                Ok(stream.into_bytes())
            },
            |error| matches!(error, HostError::CommitUncertain { .. }),
        )?;
        let controller_state = if let Some(controller) = &self.controller {
            let mut stream = MemoryStream::empty();
            let result = unsafe {
                // SAFETY: controller is live on the owning UI thread and stream is writable.
                ((*controller_table(controller)).get_state)(
                    controller.as_ptr(),
                    stream.as_interface(),
                )
            };
            if result == 0 {
                stream.into_bytes()
            } else if ResultCode::decode(result) == ResultCode::NotImplemented {
                Vec::new()
            } else {
                return Err(HostError::Operation {
                    operation: "IEditController::getState",
                    result,
                });
            }
        } else {
            Vec::new()
        };
        Ok((component_state, controller_state))
    }
}

/// A successful reactivation cannot turn a refused, possibly mutating restore
/// into a known state. The caller's recovery guard owns callback admission.
fn restore_transition<T>(
    target: &mut T,
    deactivate: impl FnOnce(&mut T) -> HostResult<()>,
    restore: impl FnOnce(&mut T) -> HostResult<()>,
    activate: impl FnOnce(&mut T) -> HostResult<()>,
) -> HostResult<()> {
    deactivate(target).map_err(|source| HostError::CommitUncertain {
        operation: "deactivate for state restore",
        source: Box::new(source),
    })?;
    let restore_result = restore(target);
    let activation_result = activate(target);
    match (restore_result, activation_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(source), Err(recovery)) => Err(HostError::RecoveryFailed {
            operation: "restore plug-in state",
            source: Box::new(source),
            recovery: Box::new(recovery),
        }),
        (Err(source), Ok(())) | (Ok(()), Err(source)) => Err(HostError::CommitUncertain {
            operation: "restore plug-in state",
            source: Box::new(source),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ControlledTarget {
        state: u32,
        active: bool,
        restore_attempted: bool,
        activation_attempted: bool,
        deactivate_result: i32,
        restore_result: i32,
        activate_result: i32,
    }

    impl ControlledTarget {
        fn new(deactivate_result: i32, restore_result: i32, activate_result: i32) -> Self {
            Self {
                state: 7,
                active: true,
                restore_attempted: false,
                activation_attempted: false,
                deactivate_result,
                restore_result,
                activate_result,
            }
        }

        fn deactivate(&mut self) -> HostResult<()> {
            self.active = false;
            require_success("IComponent::setActive(false)", self.deactivate_result)
        }

        fn restore(&mut self) -> HostResult<()> {
            assert!(
                !self.active,
                "state mutations require an inactive component"
            );
            self.restore_attempted = true;
            // A plug-in may consume and partially apply the supplied state even
            // when it refuses the operation. The host must preserve uncertainty.
            self.state = 42;
            require_success("IComponent::setState", self.restore_result)
        }

        fn activate(&mut self) -> HostResult<()> {
            self.activation_attempted = true;
            self.active = true;
            require_success("IComponent::setActive(true)", self.activate_result)
        }

        fn apply(&mut self) -> HostResult<()> {
            restore_transition(self, Self::deactivate, Self::restore, Self::activate)
        }
    }

    #[test]
    fn refused_component_restore_remains_uncertain_after_successful_reactivation() {
        let mut target = ControlledTarget::new(0, 1, 0);
        let result = target.apply();

        assert_eq!(target.state, 42);
        assert!(target.active && target.activation_attempted);
        assert!(
            matches!(result, Err(HostError::CommitUncertain { source, .. })
            if matches!(*source, HostError::Operation {
                operation: "IComponent::setState", result: 1,
            }))
        );
    }

    #[test]
    fn refused_restore_and_failed_reactivation_retain_both_causes() {
        let mut target = ControlledTarget::new(0, 1, -7);
        let result = target.apply();

        assert_eq!(target.state, 42);
        assert!(target.activation_attempted);
        assert!(
            matches!(result, Err(HostError::RecoveryFailed { source, recovery, .. })
            if matches!(*source, HostError::Operation {
                operation: "IComponent::setState", result: 1,
            }) && matches!(*recovery, HostError::Operation {
                operation: "IComponent::setActive(true)", result: -7,
            }))
        );
    }

    #[test]
    fn complete_restore_establishes_the_requested_active_state() {
        let mut target = ControlledTarget::new(0, 0, 0);
        assert!(target.apply().is_ok());
        assert_eq!(target.state, 42);
        assert!(target.active && target.restore_attempted && target.activation_attempted);
    }

    #[test]
    fn accepted_state_with_failed_reactivation_is_still_uncertain() {
        let mut target = ControlledTarget::new(0, 0, 1);
        let result = target.apply();
        assert_eq!(target.state, 42);
        assert!(
            matches!(result, Err(HostError::CommitUncertain { source, .. })
            if matches!(*source, HostError::Operation {
                operation: "IComponent::setActive(true)", result: 1,
            }))
        );
    }

    #[test]
    fn rejected_deactivation_prevents_state_mutation_and_activation() {
        let mut target = ControlledTarget::new(1, 0, 0);
        let result = target.apply();

        assert_eq!(target.state, 7);
        assert!(!target.restore_attempted && !target.activation_attempted);
        assert!(
            matches!(result, Err(HostError::CommitUncertain { source, .. })
            if matches!(*source, HostError::Operation {
                operation: "IComponent::setActive(false)", result: 1,
            }))
        );
    }
}
