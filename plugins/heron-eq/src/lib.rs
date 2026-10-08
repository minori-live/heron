//! Heron's bundled 24-band equalizer and native spectrum editor.

pub mod analyzer;
mod atomic_config;
pub mod editor;
pub mod midi;
pub mod output_pan;
pub mod params;
mod preparation;
mod processor;
pub mod response;
pub mod telemetry;

pub use params::EqParams;
pub use processor::EqDspState;
use std::sync::Arc;
use truce::prelude::*;

pub struct HeronEq;

impl PluginLogic for HeronEq {
    type Params = EqParams;
    type DspState = EqDspState;

    fn bus_layouts() -> Vec<BusLayout> {
        vec![
            BusLayout::stereo().with_sidechain_input("Sidechain", ChannelConfig::Stereo),
            BusLayout::mono().with_sidechain_input("Sidechain", ChannelConfig::Stereo),
            BusLayout::new()
                .with_input("Main", ChannelConfig::Mono)
                .with_sidechain_input("Sidechain", ChannelConfig::Stereo)
                .with_output("Main", ChannelConfig::Stereo),
        ]
    }

    fn init(_params: &EqParams, _cx: &InitContext) -> EqDspState {
        EqDspState::default()
    }

    fn reset(state: &mut EqDspState, params: &EqParams, config: &AudioConfig) {
        state.reset(params, config.sample_rate);
    }

    fn process(
        state: &mut EqDspState,
        params: &EqParams,
        buffer: &mut AudioBuffer,
        events: &EventList,
        _context: &mut ProcessContext,
    ) -> ProcessStatus {
        state.process(params, buffer, events);
        ProcessStatus::Normal
    }

    fn latency(state: &EqDspState) -> u32 {
        state.latency_samples()
    }

    fn editor(params: Arc<EqParams>) -> Box<dyn Editor> {
        editor::create(params)
    }
}

truce::plugin! { logic: HeronEq, params: EqParams }
truce::enable_rt_paranoid!();

#[cfg(test)]
mod tests;
