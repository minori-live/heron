//! Method-specific interpretation of VST3 results. A result code is not a
//! severity, and neither HRESULT sign nor nonzero means a fatal host failure.

use crate::{HostError, HostResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResultCode {
    Accepted,
    Declined,
    NotImplemented,
    NoInterface,
    Other(i32),
}

impl ResultCode {
    pub(crate) const fn decode(raw: i32) -> Self {
        match raw {
            0 => Self::Accepted,
            1 => Self::Declined,
            3 | -2147467263 | -2147483647 => Self::NotImplemented,
            -1 | -2147467262 | -2147483644 => Self::NoInterface,
            raw => Self::Other(raw),
        }
    }
}

pub(crate) fn require_success(operation: &'static str, result: i32) -> HostResult<()> {
    if ResultCode::decode(result) == ResultCode::Accepted {
        Ok(())
    } else {
        Err(HostError::Operation { operation, result })
    }
}

/// The Created-state I/O mode is an optional usage hint, not DSP setup.
pub(crate) fn io_mode_result(result: i32) -> HostResult<()> {
    match ResultCode::decode(result) {
        ResultCode::Accepted | ResultCode::Declined | ResultCode::NotImplemented => Ok(()),
        _ => Err(HostError::Operation {
            operation: "IComponent::setIoMode(simple)",
            result,
        }),
    }
}

/// The SDK's default setProcessing implementation is unimplemented. A declined
/// transition has no documented no-op guarantee and remains a rejection.
pub(crate) fn processing_notification_result(
    operation: &'static str,
    result: i32,
) -> HostResult<()> {
    match ResultCode::decode(result) {
        ResultCode::Accepted | ResultCode::NotImplemented => Ok(()),
        _ => Err(HostError::Operation { operation, result }),
    }
}

pub(crate) fn factory_context_result(result: i32) -> HostResult<()> {
    match ResultCode::decode(result) {
        ResultCode::Accepted | ResultCode::Declined | ResultCode::NotImplemented => Ok(()),
        _ => Err(HostError::Operation {
            operation: "IPluginFactory3::setHostContext",
            result,
        }),
    }
}

/// Presentation latency is an advisory extension. Its rejection is diagnosed
/// independently of the processor's required activation and setup operations.
pub(crate) fn presentation_latency_result(result: i32) -> HostResult<()> {
    match ResultCode::decode(result) {
        ResultCode::Accepted | ResultCode::Declined | ResultCode::NotImplemented => Ok(()),
        _ => Err(HostError::Operation {
            operation: "IAudioPresentationLatency::setAudioPresentationLatencySamples",
            result,
        }),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ControllerSync {
    Updated,
    Declined,
    Unsupported,
}

/// Controller synchronization never establishes processor parameter or state
/// acceptance. Callers retain its diagnostic independently of the DSP result.
pub(crate) fn controller_sync_result(
    operation: &'static str,
    result: i32,
) -> HostResult<ControllerSync> {
    match ResultCode::decode(result) {
        ResultCode::Accepted => Ok(ControllerSync::Updated),
        ResultCode::Declined => Ok(ControllerSync::Declined),
        ResultCode::NotImplemented => Ok(ControllerSync::Unsupported),
        _ => Err(HostError::Operation { operation, result }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declined_hint_does_not_accept_a_declined_processing_transition() {
        assert!(io_mode_result(1).is_ok());
        assert!(processing_notification_result("setProcessing", 1).is_err());
        assert!(require_success("setupProcessing", 1).is_err());
    }

    #[test]
    fn factory_context_rejects_positive_sdk_errors_and_unknown_codes() {
        for result in [2, 4, 5, 6, 99, -7] {
            assert!(
                matches!(factory_context_result(result), Err(HostError::Operation {
                operation: "IPluginFactory3::setHostContext", result: actual,
            }) if actual == result)
            );
        }
        for result in [0, 1, 3, -2147467263, -2147483647] {
            assert!(factory_context_result(result).is_ok());
        }
    }
}
