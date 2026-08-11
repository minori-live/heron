//! Deterministic returning-failure fixtures for plug-in containment tests.

use std::panic::{UnwindSafe, catch_unwind};

use super::{
    PluginFailureCategory, PluginFailureOutcome, PluginFailureStage, PluginRuntimeFailure,
};

/// Stable context attached to every fixture failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginFailureFixtureContext {
    pub instance_id: String,
    pub instance_generation: u32,
    pub graph_revision: u64,
}

/// A deterministic failure source that always returns control to the host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PluginFailureFixture {
    pub category: PluginFailureCategory,
    pub stage: PluginFailureStage,
    pub outcome: PluginFailureOutcome,
    pub recoverable: bool,
}

impl PluginFailureFixture {
    /// Creates a recoverable plug-in rejection at a returning operation stage.
    #[must_use]
    pub const fn returning(stage: PluginFailureStage) -> Self {
        Self {
            category: PluginFailureCategory::PluginRejected,
            stage,
            outcome: PluginFailureOutcome::Failed,
            recoverable: true,
        }
    }

    /// Creates a failure for a host-owned category with its canonical outcome.
    #[must_use]
    pub const fn category(category: PluginFailureCategory) -> Self {
        let (outcome, recoverable) = match category {
            PluginFailureCategory::PluginRejected
            | PluginFailureCategory::InvalidOutput
            | PluginFailureCategory::QueueOverflow
            | PluginFailureCategory::StaleGeneration => (PluginFailureOutcome::Failed, true),
            PluginFailureCategory::HostPanic | PluginFailureCategory::HostState => {
                (PluginFailureOutcome::Quarantined, false)
            }
        };
        Self {
            category,
            stage: PluginFailureStage::Process,
            outcome,
            recoverable,
        }
    }

    /// Returns the fixture failure without invoking third-party code.
    pub fn reject<T>(
        self,
        context: &PluginFailureFixtureContext,
    ) -> Result<T, PluginRuntimeFailure> {
        Err(self.failure(context))
    }

    /// Converts a panic from a host-owned, unwind-safe non-real-time callback.
    pub fn catch_host_panic<T, F>(
        stage: PluginFailureStage,
        context: &PluginFailureFixtureContext,
        callback: F,
    ) -> Result<T, PluginRuntimeFailure>
    where
        F: FnOnce() -> T + UnwindSafe,
    {
        match catch_unwind(callback) {
            Ok(value) => Ok(value),
            Err(_) => Err(Self {
                category: PluginFailureCategory::HostPanic,
                stage,
                outcome: PluginFailureOutcome::Quarantined,
                recoverable: false,
            }
            .failure(context)),
        }
    }

    fn failure(self, context: &PluginFailureFixtureContext) -> PluginRuntimeFailure {
        PluginRuntimeFailure {
            instance_id: context.instance_id.clone(),
            instance_generation: context.instance_generation,
            graph_revision: context.graph_revision,
            category: self.category,
            stage: self.stage,
            outcome: self.outcome,
            recoverable: self.recoverable,
            diagnostic_id: format!(
                "fixture:{}:{}:{}",
                context.instance_id,
                self.stage.as_diagnostic_segment(),
                self.category.as_diagnostic_segment()
            ),
            message: "deterministic plug-in failure fixture".to_owned(),
        }
    }
}

impl PluginFailureStage {
    const fn as_diagnostic_segment(self) -> &'static str {
        match self {
            Self::Initialize => "initialize",
            Self::Restore => "restore",
            Self::Process => "process",
            Self::Parameter => "parameter",
            Self::Editor => "editor",
            Self::StateSave => "state-save",
            Self::Ara => "ara",
        }
    }
}

impl PluginFailureCategory {
    const fn as_diagnostic_segment(self) -> &'static str {
        match self {
            Self::PluginRejected => "plugin-rejected",
            Self::InvalidOutput => "invalid-output",
            Self::HostPanic => "host-panic",
            Self::QueueOverflow => "queue-overflow",
            Self::StaleGeneration => "stale-generation",
            Self::HostState => "host-state",
        }
    }
}
