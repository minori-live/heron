use super::{
    HostedPlugin, controller_parameter_flags, controller_table, utf16_string,
    validate_controller_parameter_edit,
};
use crate::{
    HostError, HostResult, StereoProcessor,
    component_handler::HandlerShared,
    results::{ControllerSync, controller_sync_result},
};

impl HostedPlugin {
    pub fn set_parameter(&self, id: u32, normalized: f64, flush: bool) -> HostResult<()> {
        if !normalized.is_finite() || !(0.0..=1.0).contains(&normalized) {
            return Err(HostError::InvalidArgument {
                operation: "parameter value outside 0...1",
            });
        }
        if let Some(controller) = &self.controller {
            validate_controller_parameter_edit(controller_parameter_flags(controller, id)?)?;
        }
        commit_parameter_change(
            &self.shared,
            id,
            normalized,
            || {
                if let Some(controller) = &self.controller {
                    controller_sync_result("IEditController::setParamNormalized", unsafe {
                        // SAFETY: controller is live on its UI thread and the value is normalized.
                        ((*controller_table(controller)).set_parameter_normalized)(
                            controller.as_ptr(),
                            id,
                            normalized,
                        )
                    })
                } else {
                    Ok(ControllerSync::Unsupported)
                }
            },
            || {
                if flush {
                    self.processor
                        .with_paused_policy(StereoProcessor::flush_parameters, |_| true)
                } else {
                    Ok(())
                }
            },
        )
    }

    pub fn set_parameter_plain(&self, id: u32, value: f64, flush: bool) -> HostResult<()> {
        if !value.is_finite() {
            return Err(HostError::InvalidArgument {
                operation: "parameter plain value is not finite",
            });
        }
        let Some(controller) = &self.controller else {
            return Err(HostError::NullInterface("IEditController"));
        };
        validate_controller_parameter_edit(controller_parameter_flags(controller, id)?)?;
        let normalized = unsafe {
            // SAFETY: the controller is live and the parameter ID was validated
            // before entering the native conversion method.
            ((*controller_table(controller)).plain_to_normalized)(controller.as_ptr(), id, value)
        };
        self.set_parameter(id, normalized, flush)
    }

    pub fn format_parameter_value(&self, id: u32, normalized: f64) -> HostResult<String> {
        if !normalized.is_finite() || !(0.0..=1.0).contains(&normalized) {
            return Err(HostError::InvalidArgument {
                operation: "parameter value outside 0...1",
            });
        }
        let Some(controller) = &self.controller else {
            return Ok(String::new());
        };
        let mut text = [0_u16; 128];
        let result = unsafe {
            // SAFETY: controller is live, the normalized value is validated, and text is writable
            // String128 storage for the duration of this synchronous call.
            ((*controller_table(controller)).parameter_string)(
                controller.as_ptr(),
                id,
                normalized,
                text.as_mut_ptr(),
            )
        };
        Ok(if result == 0 {
            utf16_string(&text)
        } else {
            String::new()
        })
    }
}

/// Admission to the bounded processor queue is the commit point. A controller
/// rejection cannot revoke it or suppress the requested processor flush.
fn commit_parameter_change(
    shared: &HandlerShared,
    id: u32,
    normalized: f64,
    synchronize: impl FnOnce() -> HostResult<ControllerSync>,
    flush: impl FnOnce() -> HostResult<()>,
) -> HostResult<()> {
    if !shared.enqueue_parameter(id, normalized) {
        return Err(HostError::QueueFull {
            operation: "set plug-in parameter",
        });
    }
    if let Err(error) = synchronize() {
        eprintln!("VST3 controller parameter synchronization rejected: {error}");
    }
    flush().map_err(|source| HostError::CommitUncertain {
        operation: "flush committed plug-in parameter",
        source: Box::new(source),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ringbuf::{
        HeapRb,
        traits::{Consumer, Split},
    };
    use std::cell::Cell;

    #[test]
    fn controller_rejection_does_not_revoke_parameter_or_suppress_flush() {
        for result in [1, 3, 4, -7] {
            let (producer, mut consumer) = HeapRb::new(1).split();
            let shared = HandlerShared::new(producer);
            let flushed = Cell::new(false);
            commit_parameter_change(
                &shared,
                42,
                0.75,
                || controller_sync_result("IEditController::setParamNormalized", result),
                || {
                    flushed.set(true);
                    Ok(())
                },
            )
            .expect("processor queue committed the change");
            let parameter = consumer.try_pop().expect("committed processor change");
            assert_eq!((parameter.id, parameter.value), (42, 0.75));
            assert!(flushed.get());
            assert!(consumer.try_pop().is_none());
        }
    }

    #[test]
    fn full_queue_rejects_before_controller_sync_and_flush() {
        let (producer, mut consumer) = HeapRb::new(1).split();
        let shared = HandlerShared::new(producer);
        assert!(shared.enqueue_parameter(1, 0.25));
        let result = commit_parameter_change(
            &shared,
            2,
            0.75,
            || panic!("controller cannot run before admission"),
            || panic!("flush cannot run before admission"),
        );
        assert!(matches!(result, Err(HostError::QueueFull { .. })));
        let parameter = consumer.try_pop().unwrap();
        assert_eq!((parameter.id, parameter.value), (1, 0.25));
        assert!(consumer.try_pop().is_none());
    }

    #[test]
    fn full_mirror_rejects_before_either_mono_lane_commits() {
        let (primary_producer, mut primary_consumer) = HeapRb::new(1).split();
        let (secondary_producer, mut secondary_consumer) = HeapRb::new(1).split();
        let primary = HandlerShared::new(primary_producer);
        let secondary = HandlerShared::new(secondary_producer);
        assert!(secondary.enqueue_parameter(7, 0.25));
        primary.set_parameter_mirror(secondary);
        assert!(!primary.enqueue_parameter(42, 0.75));
        assert!(primary_consumer.try_pop().is_none());
        let parameter = secondary_consumer.try_pop().unwrap();
        assert_eq!((parameter.id, parameter.value), (7, 0.25));
        assert!(secondary_consumer.try_pop().is_none());
        assert!(primary.enqueue_parameter(42, 0.75));
        assert_eq!(primary_consumer.try_pop().unwrap().value, 0.75);
        assert_eq!(secondary_consumer.try_pop().unwrap().value, 0.75);
    }

    #[test]
    fn failed_flush_reports_uncertainty_after_the_queue_commit() {
        let (producer, mut consumer) = HeapRb::new(1).split();
        let shared = HandlerShared::new(producer);
        let result = commit_parameter_change(
            &shared,
            42,
            0.75,
            || Ok(ControllerSync::Updated),
            || {
                Err(HostError::Operation {
                    operation: "process(parameter flush)",
                    result: 1,
                })
            },
        );
        assert!(
            matches!(result, Err(HostError::CommitUncertain { source, .. })
            if matches!(*source, HostError::Operation { result: 1, .. }))
        );
        assert!(consumer.try_pop().is_some());
    }
}
