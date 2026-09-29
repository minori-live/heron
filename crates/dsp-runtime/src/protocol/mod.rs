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
pub use recording::*;
pub use responses::*;
pub use rpc::*;
pub use transport::*;
// The tempo map is part of the graph wire contract; it lives in `crate::tempo`
// because the render and engine paths already share that definition.
pub use crate::tempo::{TempoEvent, TimeSignatureEvent};

#[cfg(test)]
mod tests;
