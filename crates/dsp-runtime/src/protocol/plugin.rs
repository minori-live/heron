use serde::{Deserialize, Serialize};

use super::BinaryPayload;

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginFormat {
    Vst3,
    Clap,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PluginLocator {
    pub format: PluginFormat,
    pub artifact_path: String,
    pub native_id: String,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginStateChunk {
    pub key: String,
    pub bytes: BinaryPayload,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginStateEnvelope {
    pub version: u32,
    pub chunks: Vec<PluginStateChunk>,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginFailureCategory {
    PluginRejected,
    InvalidOutput,
    HostPanic,
    QueueOverflow,
    StaleGeneration,
    HostState,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginFailureStage {
    Initialize,
    Restore,
    Process,
    Parameter,
    Editor,
    StateSave,
    Ara,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginFailureOutcome {
    Failed,
    Quarantined,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginRuntimeFailure {
    pub instance_id: String,
    pub instance_generation: u32,
    pub graph_revision: u64,
    pub category: PluginFailureCategory,
    pub stage: PluginFailureStage,
    pub outcome: PluginFailureOutcome,
    pub recoverable: bool,
    pub diagnostic_id: String,
    pub message: String,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginEditorMode {
    Native,
    Parameters,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginEditorCompareSlot {
    A,
    B,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PluginEditorAction {
    Mode {
        mode: PluginEditorMode,
    },
    Compare {
        slot: PluginEditorCompareSlot,
    },
    Copy,
    Paste,
    Undo,
    Redo,
    Zoom {
        zoom_percent: u16,
    },
    SidechainRoute {
        input_port_key: String,
        source_channel_id: Option<String>,
    },
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginEditorSidechainSourceKind {
    Audio,
    Instrument,
    Aux,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginEditorSidechainBus {
    pub input_port_key: String,
    pub name: String,
    pub source_channel_id: Option<String>,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginEditorSidechainSource {
    pub id: String,
    pub name: String,
    pub kind: PluginEditorSidechainSourceKind,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginEditorToolbarState {
    pub active_mode: PluginEditorMode,
    pub zoom_percent: u16,
    pub compare_slot: PluginEditorCompareSlot,
    pub can_compare: bool,
    pub can_paste: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub sidechain_buses: Vec<PluginEditorSidechainBus>,
    pub sidechain_sources: Vec<PluginEditorSidechainSource>,
    pub sidechain_pending: bool,
}

/// Resolved theme for host-owned plug-in editor chrome.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginEditorTheme {
    Light,
    #[default]
    Dark,
}

/// Locale supported by host-owned plug-in editor chrome.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum PluginEditorLocale {
    #[serde(rename = "en-US")]
    #[default]
    EnUs,
    #[serde(rename = "zh-cmn-Hans-CN")]
    ZhCmnHansCn,
}

/// Appearance shared by all currently open host-owned editor surfaces.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginEditorAppearance {
    pub theme: PluginEditorTheme,
    pub locale: PluginEditorLocale,
}

/// Display context for one plug-in editor window.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginEditorContext {
    pub channel_name: String,
    pub channel_color: String,
    pub plugin_name: String,
    pub appearance: PluginEditorAppearance,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginEditorPreference {
    pub mode: PluginEditorMode,
    pub zoom_percent: u16,
}

impl Default for PluginEditorPreference {
    fn default() -> Self {
        Self {
            mode: PluginEditorMode::Native,
            zoom_percent: 100,
        }
    }
}

impl PluginEditorPreference {
    #[must_use]
    pub const fn is_valid(self) -> bool {
        self.zoom_percent >= 50 && self.zoom_percent <= 400
    }
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginAudioMode {
    Mono,
    MonoToStereo,
    #[default]
    Stereo,
    DualMono,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LivePluginAuxInputBus {
    pub input_port_key: String,
    pub name: String,
    pub channels: u8,
    pub source_channel_id: Option<String>,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginAuxInputConfiguration {
    pub input_port_key: String,
    pub channels: u8,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LivePluginInstance {
    pub instance_id: String,
    #[serde(default = "initial_plugin_generation")]
    pub instance_generation: u32,
    pub channel_id: String,
    pub role: String,
    pub slot_order: u32,
    #[serde(default)]
    pub audio_mode: PluginAudioMode,
    #[serde(default)]
    pub duplicate_mono_output: bool,
    pub enabled: bool,
    #[serde(default)]
    pub aux_input_buses: Vec<LivePluginAuxInputBus>,
    pub latency_samples: u32,
    pub tail_samples: Option<u32>,
}

const fn initial_plugin_generation() -> u32 {
    1
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ParameterGesture {
    Begin,
    Perform,
    End,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u32)]
#[serde(rename_all = "kebab-case")]
pub enum ParameterTargetKind {
    Plugin = 1,
    MixerChannel = 2,
    MixerSend = 3,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ParameterCommand {
    pub session_epoch: u64,
    pub sequence: u64,
    pub target_kind: ParameterTargetKind,
    pub runtime_handle: u32,
    pub parameter_token: u32,
    pub target_generation: u32,
    pub value: f64,
    pub gesture: ParameterGesture,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginParameter {
    pub parameter_key: String,
    pub runtime_token: u32,
    pub title: String,
    pub units: String,
    pub step_count: i32,
    pub default_normalized: f64,
    pub normalized: f64,
    pub min_value: f64,
    pub max_value: f64,
    pub default_value: f64,
    pub value: f64,
    pub normalized_value: f64,
    pub module_path: String,
    pub read_only: bool,
    pub hidden: bool,
    pub stepped: bool,
    pub automatable: bool,
    pub bypass: bool,
    pub formatted: String,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AraObjectKind {
    AudioSource,
    AudioModification,
    PlaybackRegion,
    Document,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AraAnalysisProgressState {
    Started,
    Updated,
    Completed,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AraArchiveDirection {
    Store,
    Restore,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AraCallbackFailureCategory {
    InvalidReference,
    QueueOverflow,
    ProviderPanic,
    HostState,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AraCallbackEvent {
    AnalysisProgress {
        object_id: String,
        state: AraAnalysisProgressState,
        progress: f32,
    },
    ContentChanged {
        object_kind: AraObjectKind,
        object_id: String,
        start_seconds: Option<f64>,
        duration_seconds: Option<f64>,
        scopes: u32,
    },
    DocumentDataChanged,
    ArchiveProgress {
        direction: AraArchiveDirection,
        progress: f32,
    },
    Quarantined {
        category: AraCallbackFailureCategory,
        recoverable: bool,
    },
}
