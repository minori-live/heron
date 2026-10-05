//! Preserve native state/parameter outcomes through local editor orchestration.

use heron_dsp_runtime::protocol::{ControlResult, PluginFailureStage, RpcError};
use heron_vst3_host::HostError;

#[derive(Debug)]
pub(in crate::runtime) enum EditorOperationError {
    Plugin(HostError),
    Restore(HostError),
    StateSave(HostError),
    Rpc(Box<RpcError>),
    Host(String),
    Clap(String),
}

impl From<HostError> for EditorOperationError {
    fn from(error: HostError) -> Self {
        Self::Plugin(error)
    }
}

impl From<RpcError> for EditorOperationError {
    fn from(error: RpcError) -> Self {
        Self::Rpc(Box::new(error))
    }
}

impl From<Box<RpcError>> for EditorOperationError {
    fn from(error: Box<RpcError>) -> Self {
        Self::Rpc(error)
    }
}

impl From<String> for EditorOperationError {
    fn from(error: String) -> Self {
        Self::Host(error)
    }
}

impl From<&str> for EditorOperationError {
    fn from(error: &str) -> Self {
        Self::Host(error.to_owned())
    }
}

impl EditorOperationError {
    pub(in crate::runtime::ui_runtime) fn into_control_result(
        self,
        instance_id: &str,
    ) -> ControlResult {
        match self {
            Self::Plugin(error) => {
                crate::vst3::failures::plugin_error(instance_id, PluginFailureStage::Editor, &error)
            }
            Self::Restore(error) => crate::vst3::failures::plugin_error(
                instance_id,
                PluginFailureStage::Restore,
                &error,
            ),
            Self::StateSave(error) => crate::vst3::failures::plugin_error(
                instance_id,
                PluginFailureStage::StateSave,
                &error,
            ),
            Self::Rpc(error) => ControlResult::Error { error: *error },
            Self::Host(error) => crate::vst3::failures::diagnostic_error(
                instance_id,
                PluginFailureStage::Editor,
                "editor action",
                error,
            ),
            Self::Clap(message) => crate::control_error_result(message),
        }
    }
}
