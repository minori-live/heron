use crate::HostResult;

use super::HostedPlugin;

impl HostedPlugin {
    /// Keeps both lanes paused through state capture, mutation and rollback.
    /// Successful recovery validates both lanes; failed recovery keeps both
    /// unavailable. Existing paired bus uncertainty requires rebuilding owners.
    pub fn with_processing_pair_recovery<T>(
        &self,
        secondary: Option<&Self>,
        action: impl FnOnce() -> HostResult<T>,
    ) -> HostResult<T> {
        self.processor.with_pair_transaction(
            secondary.map(|lane| lane.processor.as_ref()),
            true,
            action,
        )
    }

    /// Holds both lanes through a paired bus mutation. Partial commits keep
    /// both unavailable: a lane-local restart cannot reconcile bus overrides.
    pub fn with_processing_pair_mutation<T>(
        &self,
        secondary: Option<&Self>,
        action: impl FnOnce() -> HostResult<T>,
    ) -> HostResult<T> {
        let Some(secondary) = secondary else {
            return action();
        };
        self.processor
            .with_pair_transaction(Some(secondary.processor.as_ref()), false, action)
    }
}
