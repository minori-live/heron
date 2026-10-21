use serde::{Deserialize, Serialize};

use super::{BounceJobState, LiveMixerGraph};

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrackFreezeMode {
    PreFader,
    SourceOnly,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrackFreezeRenderRequest {
    pub operation_id: String,
    pub graph_revision: u64,
    pub graph: LiveMixerGraph,
    pub channel_id: String,
    pub mode: TrackFreezeMode,
    pub start_frame: u64,
    pub end_frame: u64,
    pub output_path: String,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrackFreezeJobPhase {
    Preparing,
    Rendering,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrackFreezeJobStatus {
    pub operation_id: String,
    pub state: BounceJobState,
    pub phase: TrackFreezeJobPhase,
    pub completed_units: u64,
    pub total_units: u64,
    pub rendered_frames: Option<u64>,
    pub tail_frames: Option<u64>,
    pub latency_samples: Option<u32>,
    pub tail_truncated: bool,
    pub error: Option<String>,
}
