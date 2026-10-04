#![cfg_attr(
    not(test),
    deny(
        clippy::expect_used,
        clippy::panic,
        clippy::panic_in_result_fn,
        clippy::unwrap_used
    )
)]

mod audio;
mod binary;
mod bounce;
mod commands;
mod events;
mod graph;
mod midi_input;
mod plugin;
mod plugin_analysis;
#[cfg(test)]
pub mod plugin_failure_fixture;
mod recording;
mod responses;
mod rpc;
mod transport;

pub use audio::*;
pub use binary::*;
pub use bounce::*;
pub use commands::*;
pub use events::*;
pub use graph::*;
pub use midi_input::*;
pub use plugin::*;
pub use plugin_analysis::*;
pub use recording::*;
pub use responses::*;
pub use rpc::*;
pub use transport::*;
// The tempo map is part of the graph wire contract; it lives in `crate::tempo`
// because the render and engine paths already share that definition.
pub use crate::tempo::{TempoEvent, TimeSignatureEvent};

#[cfg(test)]
mod tests;

/// Writes the TypeScript declarations for the wire types.
///
/// Run with `cargo test -p heron-dsp-runtime --features ts-export export_typescript`,
/// setting `TS_RS_EXPORT_DIR` to the directory that should receive them. The
/// crate writes nothing on its own otherwise.
#[cfg(all(test, feature = "ts-export"))]
mod ts_export {
    use ts_rs::{Config, TS};

    /// `@msgpack/msgpack` yields an ordinary number for every `u64` the protocol
    /// actually carries: the epochs travel as strings, and the ticks and frame
    /// counts stay well below `2^53`. Declaring them `bigint` would describe a
    /// value the decoder never produces.
    pub(crate) fn config() -> Config {
        Config::from_env().with_large_int("number")
    }

    pub(crate) fn export() -> Result<(), ts_rs::ExportError> {
        super::LiveMixerGraph::export_all(&config())?;
        super::PluginAnalysisJobStatus::export_all(&config())
    }
}

#[cfg(all(test, feature = "ts-export"))]
#[test]
fn export_typescript() {
    ts_export::export().expect("wire types must export");
}
