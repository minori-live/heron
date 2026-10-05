//! VST3 operation policy at the native request boundary.

use std::sync::atomic::Ordering;

use heron_dsp_runtime::protocol::{
    ControlResult, PluginFailureStage, PluginFormat, RpcError, RpcErrorCategory, RpcErrorCode,
    RpcErrorDetails, RpcMutationOutcome, RpcRetry,
};
use heron_vst3_host::HostError;

pub(crate) fn plugin_error(
    instance_id: &str,
    stage: PluginFailureStage,
    error: &HostError,
) -> ControlResult {
    ControlResult::Error {
        error: plugin_rpc_error(Some(instance_id), stage, error),
    }
}

/// A load candidate has never been published. Its failure does not change the
/// existing graph even when the candidate's own state cannot be recovered.
pub(super) fn candidate_error(
    instance_id: &str,
    stage: PluginFailureStage,
    error: &HostError,
) -> ControlResult {
    let mut error = plugin_rpc_error(Some(instance_id), stage, error);
    error.outcome = RpcMutationOutcome::NotCommitted;
    if error.retry == RpcRetry::AfterReconcile {
        error.retry = RpcRetry::Never;
        error.code = RpcErrorCode::DependencyFailed;
        error.category = RpcErrorCategory::DependencyFailed;
    }
    ControlResult::Error { error }
}

pub(super) fn recovered_error(error: HostError) -> HostError {
    match error {
        HostError::CommitUncertain { source, .. } | HostError::RecoveryFailed { source, .. } => {
            recovered_error(*source)
        }
        error => error,
    }
}

pub(crate) fn plugin_rpc_error(
    instance_id: Option<&str>,
    stage: PluginFailureStage,
    error: &HostError,
) -> RpcError {
    let (code, category, outcome, retry) = match error {
        HostError::InvalidClassId(_) | HostError::InvalidArgument { .. } => (
            RpcErrorCode::ValidationFailed,
            RpcErrorCategory::Validation,
            RpcMutationOutcome::NotCommitted,
            RpcRetry::Never,
        ),
        HostError::QueueFull { .. } => (
            RpcErrorCode::ResourceBusy,
            RpcErrorCategory::Busy,
            RpcMutationOutcome::NotCommitted,
            RpcRetry::Safe,
        ),
        HostError::CommitUncertain { .. } => (
            RpcErrorCode::DependencyFailed,
            RpcErrorCategory::DependencyFailed,
            RpcMutationOutcome::Unknown,
            RpcRetry::AfterReconcile,
        ),
        HostError::RecoveryFailed { .. } => (
            RpcErrorCode::DependencyFailed,
            RpcErrorCategory::DependencyFailed,
            RpcMutationOutcome::Quarantined,
            RpcRetry::AfterReconcile,
        ),
        _ => (
            RpcErrorCode::DependencyFailed,
            RpcErrorCategory::DependencyFailed,
            RpcMutationOutcome::NotCommitted,
            RpcRetry::Never,
        ),
    };
    let (operation, result) = native_context(error);
    operation_error(
        instance_id,
        stage,
        operation,
        result,
        code,
        category,
        outcome,
        retry,
        error,
    )
}

fn native_context(error: &HostError) -> (&str, Option<i32>) {
    match error {
        HostError::Operation { operation, result } => (operation, Some(*result)),
        HostError::InvalidArgument { operation }
        | HostError::InvalidPluginData { operation }
        | HostError::UnsupportedOperation { operation }
        | HostError::QueueFull { operation } => (operation, None),
        HostError::RecoveryFailed { source, .. } | HostError::CommitUncertain { source, .. } => {
            native_context(source)
        }
        HostError::InvalidClassId(_) => ("parse class ID", None),
        HostError::ModuleOpen { .. }
        | HostError::ModuleBinary(_)
        | HostError::BundleLoad { .. } => ("load module", None),
        HostError::MissingEntryPoint(operation) | HostError::NullInterface(operation) => {
            (operation, None)
        }
        HostError::Ara(_) => ("ARA lifecycle", None),
        _ => ("VST3 operation", None),
    }
}

#[allow(clippy::too_many_arguments)]
fn operation_error(
    instance_id: Option<&str>,
    stage: PluginFailureStage,
    operation: &str,
    result: Option<i32>,
    code: RpcErrorCode,
    category: RpcErrorCategory,
    outcome: RpcMutationOutcome,
    retry: RpcRetry,
    diagnostic: impl std::fmt::Display,
) -> RpcError {
    let correlation_id = format!(
        "audio-host-{}",
        crate::ERROR_CORRELATION.fetch_add(1, Ordering::Relaxed)
    );
    eprintln!("audio-host [{correlation_id}]: {diagnostic}");
    RpcError {
        code,
        category,
        outcome,
        retry,
        correlation_id,
        user_message_key: "errors.pluginOperationFailed".to_owned(),
        // This adapter has native handles, not the caller's authoritative
        // ResourceRef epoch/generation. Keep instance context without inventing it.
        resource: None,
        details: Some(RpcErrorDetails::PluginOperation {
            format: PluginFormat::Vst3,
            instance_id: instance_id.filter(|id| !id.is_empty()).map(str::to_owned),
            stage,
            operation: operation.to_owned(),
            result,
        }),
    }
}

pub(super) fn invalid_argument(
    instance_id: &str,
    stage: PluginFailureStage,
    operation: &'static str,
) -> ControlResult {
    plugin_error(
        instance_id,
        stage,
        &HostError::InvalidArgument { operation },
    )
}

pub(super) fn missing_instance(instance_id: &str, stage: PluginFailureStage) -> ControlResult {
    let error = operation_error(
        Some(instance_id),
        stage,
        "instance lookup",
        None,
        RpcErrorCode::StaleResource,
        RpcErrorCategory::StaleResource,
        RpcMutationOutcome::NotCommitted,
        RpcRetry::AfterReconcile,
        "VST3 instance is not loaded",
    );
    ControlResult::Error { error }
}

pub(crate) fn diagnostic_error(
    instance_id: &str,
    stage: PluginFailureStage,
    operation: &'static str,
    diagnostic: impl std::fmt::Display,
) -> ControlResult {
    ControlResult::Error {
        error: diagnostic_rpc_error(Some(instance_id), stage, operation, diagnostic),
    }
}

pub(super) fn diagnostic_rpc_error(
    instance_id: Option<&str>,
    stage: PluginFailureStage,
    operation: &'static str,
    diagnostic: impl std::fmt::Display,
) -> RpcError {
    operation_error(
        instance_id,
        stage,
        operation,
        None,
        RpcErrorCode::DependencyFailed,
        RpcErrorCategory::DependencyFailed,
        RpcMutationOutcome::NotCommitted,
        RpcRetry::Never,
        diagnostic,
    )
}

pub(super) fn uncertain_diagnostic_rpc_error(
    instance_id: &str,
    stage: PluginFailureStage,
    operation: &'static str,
    diagnostic: impl std::fmt::Display,
) -> RpcError {
    operation_error(
        Some(instance_id),
        stage,
        operation,
        None,
        RpcErrorCode::DependencyFailed,
        RpcErrorCategory::DependencyFailed,
        RpcMutationOutcome::Unknown,
        RpcRetry::AfterReconcile,
        diagnostic,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_metadata_and_capability_failures_do_not_invent_native_results() {
        for failure in [
            HostError::InvalidPluginData {
                operation: "IUnitInfo count",
            },
            HostError::UnsupportedOperation {
                operation: "reload component",
            },
        ] {
            let error = plugin_rpc_error(Some("fx"), PluginFailureStage::Initialize, &failure);
            assert_eq!(error.category, RpcErrorCategory::DependencyFailed);
            assert_eq!(error.outcome, RpcMutationOutcome::NotCommitted);
            assert!(
                matches!(error.details, Some(RpcErrorDetails::PluginOperation {
                result: None, operation, ..
            }) if operation != "VST3 operation")
            );
        }
    }

    #[test]
    fn plugin_rejection_keeps_instance_and_method_without_quarantining_the_engine() {
        let error = plugin_rpc_error(
            Some("compressor"),
            PluginFailureStage::Initialize,
            &HostError::Operation {
                operation: "setupProcessing",
                result: 1,
            },
        );
        assert_eq!(error.category, RpcErrorCategory::DependencyFailed);
        assert_eq!(error.outcome, RpcMutationOutcome::NotCommitted);
        assert_eq!(error.retry, RpcRetry::Never);
        assert_eq!(error.user_message_key, "errors.pluginOperationFailed");
        assert!(
            matches!(error.details, Some(RpcErrorDetails::PluginOperation {
            instance_id: Some(id), operation, result: Some(1), ..
        }) if id == "compressor" && operation == "setupProcessing")
        );
    }

    #[test]
    fn full_queue_can_be_retried_but_a_failed_committed_flush_requires_reconciliation() {
        let full = plugin_rpc_error(
            Some("fx"),
            PluginFailureStage::Parameter,
            &HostError::QueueFull {
                operation: "parameter enqueue",
            },
        );
        assert_eq!(full.category, RpcErrorCategory::Busy);
        assert_eq!(full.outcome, RpcMutationOutcome::NotCommitted);
        assert_eq!(full.retry, RpcRetry::Safe);
        let uncertain = plugin_rpc_error(
            Some("fx"),
            PluginFailureStage::Parameter,
            &HostError::CommitUncertain {
                operation: "parameter flush",
                source: Box::new(HostError::Operation {
                    operation: "process",
                    result: 1,
                }),
            },
        );
        assert_eq!(uncertain.outcome, RpcMutationOutcome::Unknown);
        assert_eq!(uncertain.retry, RpcRetry::AfterReconcile);
    }

    #[test]
    fn failed_recovery_quarantines_only_the_named_operation() {
        let error = plugin_rpc_error(
            Some("fx"),
            PluginFailureStage::Restore,
            &HostError::RecoveryFailed {
                operation: "state restore",
                source: Box::new(HostError::Operation {
                    operation: "setState",
                    result: 1,
                }),
                recovery: Box::new(HostError::Operation {
                    operation: "setActive",
                    result: -7,
                }),
            },
        );
        assert_eq!(error.category, RpcErrorCategory::DependencyFailed);
        assert_eq!(error.outcome, RpcMutationOutcome::Quarantined);
        assert_eq!(error.retry, RpcRetry::AfterReconcile);
    }

    #[test]
    fn discarded_load_candidate_does_not_quarantine_the_existing_graph() {
        let error = HostError::CommitUncertain {
            operation: "restore candidate",
            source: Box::new(HostError::Operation {
                operation: "IComponent::setState",
                result: 1,
            }),
        };
        let ControlResult::Error { error } =
            candidate_error("candidate", PluginFailureStage::Restore, &error)
        else {
            panic!("candidate failure must be a typed error");
        };
        assert_eq!(error.outcome, RpcMutationOutcome::NotCommitted);
        assert_eq!(error.retry, RpcRetry::Never);
        assert_eq!(error.category, RpcErrorCategory::DependencyFailed);
    }

    #[test]
    fn successful_rollback_restores_retry_policy_to_a_known_rejection() {
        let error = recovered_error(HostError::CommitUncertain {
            operation: "restore editor state",
            source: Box::new(HostError::Operation {
                operation: "IComponent::setState",
                result: 1,
            }),
        });
        let error = plugin_rpc_error(Some("fx"), PluginFailureStage::Restore, &error);
        assert_eq!(error.outcome, RpcMutationOutcome::NotCommitted);
        assert_eq!(error.retry, RpcRetry::Never);
    }
}
