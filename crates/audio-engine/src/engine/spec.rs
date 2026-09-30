// Owned by the protocol crate; this module keeps the engine-facing path stable.
pub use heron_dsp_runtime::protocol::{
    ApplicationCaptureLogicalTarget, AudioEngineConfig, AudioRuntime, MixerChannelMeter,
    MixerParameterPreview, RoundTripLatencyMeasurement, RoundTripLatencyMeasurementRequest,
};

use super::{
    LiveMixerSendTap, LiveMixerSystemRole, LowLatencyChannel, LowLatencyPlan, LowLatencyPlugin,
    PluginAudioMode, TempoEvent, TimeSignatureEvent, plan_low_latency,
};

#[derive(Clone)]
pub struct ResolvedMixerChannel {
    pub id: String,
    pub name: String,
    pub color: String,
    pub kind: String,
    pub system_role: Option<LiveMixerSystemRole>,
    pub gain_db: f64,
    pub pan: f64,
    pub muted: bool,
    pub soloed: bool,
    pub output_index: Option<u32>,
    pub output_bus: Option<u32>,
    pub record_armed: bool,
    pub input_monitoring: bool,
    pub input_source: Option<String>,
    pub input_channels: Vec<u32>,
    pub application_capture: Option<ApplicationCaptureLogicalTarget>,
    pub hardware_output_channels: Vec<u32>,
    pub midi_input_port_id: Option<String>,
    pub midi_input_channel: Option<u8>,
}

#[derive(Clone)]
pub struct ResolvedPluginAuxInputBus {
    pub input_port_key: String,
    pub input_port_token: u32,
    pub name: String,
    pub channels: u8,
    pub source_index: Option<u32>,
}

#[derive(Clone)]
pub struct ResolvedMixerSend {
    pub id: String,
    pub source_index: u32,
    pub target_output_index: Option<u32>,
    pub target_bus: Option<u32>,
    pub enabled: bool,
    pub tap: LiveMixerSendTap,
    pub level_db: f64,
}

#[derive(Clone)]
pub struct ResolvedMixerClip {
    pub id: String,
    pub channel_index: u32,
    pub start_frame: i64,
    pub source_offset_frames: i64,
    pub length_frames: i64,
    pub fade_in_frames: i64,
    pub fade_out_frames: i64,
    pub path: String,
}

#[derive(Clone)]
pub struct ResolvedPluginInstance {
    pub instance_id: String,
    pub instance_generation: u32,
    pub channel_index: u32,
    pub role: String,
    pub slot_order: u32,
    pub audio_mode: PluginAudioMode,
    pub duplicate_mono_output: bool,
    pub enabled: bool,
    pub aux_input_buses: Vec<ResolvedPluginAuxInputBus>,
    pub latency_samples: u32,
    pub tail_samples: Option<u32>,
}

#[derive(Clone)]
pub struct DecodedMidiNote {
    pub start_tick: u64,
    pub duration_ticks: u64,
    pub channel: u8,
    pub key: u8,
    pub velocity: u8,
    pub release_velocity: u8,
}

#[derive(Clone)]
pub enum DecodedMidiEventKind {
    ControlChange { controller: u8, value: u8 },
    PitchBend { value: u16 },
    ProgramChange { program: u8 },
    ChannelPressure { pressure: u8 },
    PolyPressure { key: u8, pressure: u8 },
    SysEx { data: Vec<u8> },
}

#[derive(Clone)]
pub struct DecodedMidiEvent {
    pub tick: u64,
    pub channel: u8,
    pub kind: DecodedMidiEventKind,
}

#[derive(Clone)]
pub struct DecodedMidiClip {
    pub id: String,
    pub channel_index: u32,
    pub start_tick: u64,
    pub source_offset_ticks: u64,
    pub length_ticks: u64,
    pub notes: Vec<DecodedMidiNote>,
    pub events: Vec<DecodedMidiEvent>,
}

#[derive(Clone)]
pub struct ResolvedMixerGraph {
    pub generation: u64,
    pub sample_rate: u32,
    pub project_end_tick: u64,
    pub latency_policy: ResolvedLatencyPolicy,
    pub channels: Vec<ResolvedMixerChannel>,
    pub sends: Vec<ResolvedMixerSend>,
    pub clips: Vec<ResolvedMixerClip>,
    pub plugins: Vec<ResolvedPluginInstance>,
    pub midi_clips: Vec<DecodedMidiClip>,
    pub tempo_events: Vec<TempoEvent>,
    pub time_signature_events: Vec<TimeSignatureEvent>,
}

#[derive(Clone, Default)]
pub enum ResolvedLatencyPolicy {
    #[default]
    Normal,
    LowLatency {
        target_output_index: u32,
        plugin_budget_samples: u32,
    },
}

pub(super) fn plan_native_low_latency(native: &ResolvedMixerGraph) -> LowLatencyPlan {
    let ResolvedLatencyPolicy::LowLatency {
        target_output_index,
        plugin_budget_samples,
    } = &native.latency_policy
    else {
        return LowLatencyPlan {
            sensitive_channels: vec![false; native.channels.len()],
            ..LowLatencyPlan::default()
        };
    };
    plan_low_latency(
        &native
            .channels
            .iter()
            .map(|channel| LowLatencyChannel {
                output: channel.output_index.map(|index| index as usize),
                input_buses: if channel.input_source.as_deref() == Some("bus") {
                    channel.input_channels.clone()
                } else {
                    Vec::new()
                },
                output_bus: channel.output_bus,
                monitored: channel.input_monitoring
                    && (channel.kind == "instrument"
                        || channel.input_source.as_deref() == Some("hardware")
                        || channel.input_source.as_deref() == Some("application")),
            })
            .collect::<Vec<_>>(),
        &native
            .plugins
            .iter()
            .map(|plugin| LowLatencyPlugin {
                instance_id: plugin.instance_id.clone(),
                channel: plugin.channel_index as usize,
                slot_order: plugin.slot_order,
                latency_samples: plugin.latency_samples,
                instrument: plugin.role == "instrument",
            })
            .collect::<Vec<_>>(),
        *target_output_index as usize,
        *plugin_budget_samples,
    )
}

pub struct MixerSnapshot {
    pub meters: Vec<MixerChannelMeter>,
}

pub struct TransportSnapshot {
    pub state: String,
    pub position_frames: i64,
    pub position_ticks: i64,
    pub sample_rate: u32,
    pub effective_bpm: Option<f64>,
    pub clock_source: String,
    pub waiting_for: Option<String>,
    pub loop_enabled: bool,
    pub loop_start_tick: Option<i64>,
    pub loop_end_tick: Option<i64>,
}
