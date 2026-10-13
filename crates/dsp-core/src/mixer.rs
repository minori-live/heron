use std::{collections::VecDeque, error::Error, fmt};

use fearless_simd::Level;

pub type StereoFrame = [f32; 2];
pub const MAX_BUS_CHANNELS: usize = 256;
pub const MAX_OUTPUT_CHANNELS: usize = 32;
pub type HardwareOutputFrame = [f32; MAX_OUTPUT_CHANNELS];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelKind {
    Audio,
    Instrument,
    Aux,
    Master,
    Output,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendTap {
    Pre,
    Post,
    PostPan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteTarget {
    /// One zero-based BUS lane, receiving the L/R average.
    Bus(usize),
    /// Adjacent zero-based BUS lanes, receiving L and R separately.
    StereoBus(usize),
    Output(usize),
    /// The L/R average duplicated into an Output channel.
    MonoOutput(usize),
}

impl RouteTarget {
    pub fn bus_contains(self, inputs: &[usize]) -> bool {
        match self {
            Self::Bus(bus) => inputs.contains(&bus),
            Self::StereoBus(bus) => {
                inputs.contains(&bus)
                    || bus
                        .checked_add(1)
                        .is_some_and(|right| inputs.contains(&right))
            }
            Self::Output(_) | Self::MonoOutput(_) => false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChannelSpec {
    pub id: String,
    pub kind: ChannelKind,
    pub gain_db: f32,
    pub pan: f32,
    pub muted: bool,
    pub soloed: bool,
    pub output: Option<RouteTarget>,
    pub input_bus: Option<[usize; 2]>,
    pub hardware_output: Option<[usize; 2]>,
}

#[derive(Debug, Clone)]
pub struct SendSpec {
    pub id: String,
    pub source: usize,
    pub target: RouteTarget,
    pub enabled: bool,
    pub tap: SendTap,
    pub level_db: f32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ChannelPeak {
    pub pre: StereoFrame,
    pub post: StereoFrame,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    MissingMaster,
    MultipleMasters,
    MissingOutput,
    InvalidOutput,
    InvalidSend,
    RoutingCycle,
    InvalidParameter,
    InvalidBlock,
}

impl fmt::Display for GraphError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::MissingMaster => "mixer graph requires one master channel",
            Self::MultipleMasters => "mixer graph contains more than one master channel",
            Self::MissingOutput => "mixer graph requires at least one hardware output channel",
            Self::InvalidOutput => "mixer channel has an invalid output",
            Self::InvalidSend => "mixer send has an invalid source or target",
            Self::RoutingCycle => "mixer routing must not contain a cycle",
            Self::InvalidParameter => "mixer parameter is outside its supported range",
            Self::InvalidBlock => "mixer block shape exceeds the prepared capacity",
        })
    }
}

impl Error for GraphError {}

#[derive(Debug, Clone, Copy)]
struct SmoothedValue {
    current: f32,
    target: f32,
    coefficient: f32,
}

impl SmoothedValue {
    fn new(value: f32, sample_rate: u32) -> Self {
        let smoothing_frames = (sample_rate as f32 * 0.010).max(1.0);
        Self {
            current: value,
            target: value,
            coefficient: 1.0 / smoothing_frames,
        }
    }

    fn set_target(&mut self, value: f32) {
        self.target = value;
    }

    fn next(&mut self) -> f32 {
        self.current += (self.target - self.current) * self.coefficient;
        if (self.current - self.target).abs() < 1.0e-6 {
            self.current = self.target;
        }
        self.current
    }

    /// Fills `out` with the same sequence [`Self::next`] would produce.
    ///
    /// Settled values fill the block in one write. Ramps still snap to the
    /// target once the residual drops below the per-sample threshold, then
    /// fill the remainder without further branching.
    ///
    /// Kept out-of-line so the per-frame [`Self::next`] hot path stays compact.
    #[inline(never)]
    fn fill_next(&mut self, out: &mut [f32]) {
        if out.is_empty() {
            return;
        }
        if self.current == self.target {
            out.fill(self.current);
            return;
        }

        let target = self.target;
        let coefficient = self.coefficient;
        let mut current = self.current;
        let mut index = 0;
        while index < out.len() {
            current += (target - current) * coefficient;
            if (current - target).abs() < 1.0e-6 {
                current = target;
                out[index..].fill(current);
                self.current = current;
                return;
            }
            out[index] = current;
            index += 1;
        }
        self.current = current;
    }
}

#[derive(Debug, Clone)]
struct ChannelRuntime {
    gain: SmoothedValue,
    pan: SmoothedValue,
    output_delay: StereoDelay,
}

#[derive(Debug, Clone)]
struct SendRuntime {
    gain: SmoothedValue,
    delay: StereoDelay,
}

#[derive(Debug, Clone, Default)]
struct StereoDelay {
    frames: Vec<StereoFrame>,
    cursor: usize,
}

impl StereoDelay {
    fn set_frames(&mut self, frames: usize) {
        self.frames = vec![[0.0; 2]; frames];
        self.cursor = 0;
    }

    fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    fn process(&mut self, input: StereoFrame) -> StereoFrame {
        if self.frames.is_empty() {
            return input;
        }
        let output = self.frames[self.cursor];
        self.frames[self.cursor] = input;
        self.cursor += 1;
        if self.cursor == self.frames.len() {
            self.cursor = 0;
        }
        output
    }

    fn clear(&mut self) {
        self.frames.fill([0.0; 2]);
        self.cursor = 0;
    }
}

/// Scratch buffers and SIMD level used only by [`MixerGraph::process_block_with_sources`].
///
/// Stored behind `Option<Box<_>>` so [`MixerGraph::process_frame`] keeps a compact
/// layout when block processing was never prepared. `Level` is detected in
/// [`MixerGraph::prepare_block_processing`], never on the per-frame path.
struct BlockProcessingState {
    simd_level: Level,
    capacity: usize,
    bus_count: usize,
    bus_accumulation: Vec<f32>,
    master_gains: Vec<f32>,
    master_pans: Vec<f32>,
    channel_gains: Vec<f32>,
    channel_pans: Vec<f32>,
    send_gains: Vec<f32>,
    post_pan: Vec<StereoFrame>,
    post_fader: Vec<StereoFrame>,
    send_tap: Vec<StereoFrame>,
}

pub struct MixerGraph {
    channels: Vec<ChannelSpec>,
    sends: Vec<SendSpec>,
    order: Vec<usize>,
    audible: Vec<bool>,
    output_audible: Vec<bool>,
    send_audible: Vec<bool>,
    solo_edges: Vec<Vec<usize>>,
    solo_upstream: Vec<bool>,
    solo_downstream: Vec<bool>,
    channel_runtime: Vec<ChannelRuntime>,
    send_runtime: Vec<SendRuntime>,
    accumulation: Vec<StereoFrame>,
    bus_accumulation: [f32; MAX_BUS_CHANNELS],
    peaks: Vec<ChannelPeak>,
    sends_by_source: Vec<Vec<usize>>,
    master: usize,
    /// Highest bus index + 1; used when allocating [`BlockProcessingState`].
    block_bus_count: usize,
    block: Option<Box<BlockProcessingState>>,
}

mod graph;
mod runtime;
mod simd;
#[cfg(test)]
mod tests;

pub use graph::{balance_stereo, pan_mono};

#[cfg(test)]
mod smoothed_tests {
    use super::SmoothedValue;

    #[test]
    fn fill_next_matches_per_sample_next() {
        let mut per_sample = SmoothedValue::new(1.0, 1_000);
        let mut block_wise = SmoothedValue::new(1.0, 1_000);
        per_sample.set_target(0.0);
        block_wise.set_target(0.0);

        let mut expected = [0.0; 32];
        for sample in &mut expected {
            *sample = per_sample.next();
        }
        let mut actual = [0.0; 32];
        block_wise.fill_next(&mut actual);
        for (actual_sample, expected_sample) in actual.iter().zip(expected) {
            assert!((actual_sample - expected_sample).abs() < 1.0e-7);
        }

        let mut settled_expected = [0.0; 16];
        for sample in &mut settled_expected {
            *sample = per_sample.next();
        }
        let mut settled_actual = [0.0; 16];
        block_wise.fill_next(&mut settled_actual);
        assert_eq!(settled_actual, settled_expected);
    }

    #[test]
    fn fill_next_handles_empty_settled_and_mid_ramp_snap() {
        let mut empty = SmoothedValue::new(0.5, 48_000);
        empty.fill_next(&mut []);
        assert!((empty.next() - 0.5).abs() < 1.0e-7);

        let mut settled = SmoothedValue::new(-3.0, 48_000);
        let mut block = [0.0; 8];
        settled.fill_next(&mut block);
        assert_eq!(block, [-3.0; 8]);

        // coefficient == 1.0 snaps to the target on the first sample, then fills
        // the remainder without further branching.
        let mut snapping = SmoothedValue::new(0.0, 1);
        snapping.set_target(1.0);
        let mut snapped = [0.0; 5];
        snapping.fill_next(&mut snapped);
        assert_eq!(snapped, [1.0; 5]);
        assert!((snapping.next() - 1.0).abs() < 1.0e-7);

        // Short ramp that settles inside the block exercises the mid-ramp fill.
        let mut mid_snap = SmoothedValue::new(1.0, 1_000);
        mid_snap.set_target(0.0);
        let mut long_block = [0.0_f32; 256];
        mid_snap.fill_next(&mut long_block);
        assert!(
            long_block
                .iter()
                .any(|sample| *sample > 0.0 && *sample < 1.0)
        );
        assert_eq!(*long_block.last().unwrap(), 0.0);
        let first_settled = long_block
            .iter()
            .position(|sample| *sample == 0.0)
            .expect("ramp must settle inside the block");
        assert!(first_settled > 0);
        assert!(
            long_block[first_settled..]
                .iter()
                .all(|sample| *sample == 0.0)
        );
    }
}
