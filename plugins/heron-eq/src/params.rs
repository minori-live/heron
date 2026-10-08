//! Stable host automation slots, independent of which bands are present.

use crate::telemetry::EqTelemetry;
use heron_dsp_core::eq::{
    EqBand, EqChannel, EqConfig, EqShape, LinearPhaseResolution, MAX_EQ_BANDS, ProcessingMode,
};
use std::sync::Arc;
use truce::prelude::*;

pub const BAND_BASE: u32 = 100;
pub const BAND_STRIDE: u32 = 32;

#[derive(Params)]
pub struct BandParams {
    #[param(id = 0, name = "Present", default = false)]
    pub present: BoolParam,
    #[param(id = 1, name = "Enabled", default = true)]
    pub enabled: BoolParam,
    #[param(id = 2, name = "Shape", range = "discrete(0, 9)", default = 0)]
    pub shape: IntParam,
    #[param(
        id = 3,
        name = "Frequency",
        range = "log(1, 30000)",
        unit = "Hz",
        default = 1000
    )]
    pub frequency: FloatParam,
    #[param(
        id = 4,
        name = "Gain",
        range = "linear(-36, 36)",
        unit = "dB",
        default = 0
    )]
    pub gain: FloatParam,
    #[param(id = 5, name = "Q", range = "log(0.025, 40)", default = std::f64::consts::FRAC_1_SQRT_2)]
    pub q: FloatParam,
    #[param(id = 6, name = "Slope", range = "linear(0, 1000)", default = 12)]
    pub slope: FloatParam,
    #[param(id = 7, name = "Channel", range = "discrete(0, 4)", default = 0)]
    pub channel: IntParam,
    // Removed parameter slots remain reserved; existing automation IDs never shift.
    #[param(id = 19, name = "Band order", range = "discrete(0, 23)", default = 0)]
    pub order: IntParam,
}

#[derive(Params)]
pub struct EqParams {
    #[param(
        id = 0,
        name = "Output",
        range = "linear(-60, 60)",
        unit = "dB",
        default = 0
    )]
    pub output_gain: FloatParam,
    #[param(id = 1, name = "Bypass", default = false, flags = "bypass")]
    pub bypass: BoolParam,
    #[param(
        id = 2,
        name = "Processing mode",
        range = "discrete(0, 2)",
        default = 0
    )]
    pub processing_mode: IntParam,
    #[param(id = 3, name = "Gain scale", range = "linear(0, 2)", default = 1)]
    pub gain_scale: FloatParam,
    #[param(id = 4, name = "Phase invert", default = false)]
    pub phase_invert: BoolParam,
    #[param(id = 5, name = "Auto gain", default = false)]
    pub auto_gain: BoolParam,
    // Global slot 6 is retired; later automation IDs stay unchanged.
    #[param(
        id = 7,
        name = "Linear phase resolution",
        range = "discrete(0, 4)",
        default = 2
    )]
    pub linear_phase_resolution: IntParam,
    #[param(id = 8, name = "Output pan", range = "linear(-1, 1)", default = 0)]
    pub output_pan: FloatParam,
    #[param(
        id = 9,
        name = "Output pan mode",
        range = "discrete(0, 1)",
        default = 0
    )]
    pub output_pan_mode: IntParam,
    #[param(id = 10, name = "Output mute", default = false)]
    pub output_mute: BoolParam,
    #[persist]
    pub midi_bindings: crate::midi::MidiBindings,
    #[skip]
    pub telemetry: Arc<EqTelemetry>,
    #[nested(base = 100)]
    pub band01: BandParams,
    #[nested(base = 132)]
    pub band02: BandParams,
    #[nested(base = 164)]
    pub band03: BandParams,
    #[nested(base = 196)]
    pub band04: BandParams,
    #[nested(base = 228)]
    pub band05: BandParams,
    #[nested(base = 260)]
    pub band06: BandParams,
    #[nested(base = 292)]
    pub band07: BandParams,
    #[nested(base = 324)]
    pub band08: BandParams,
    #[nested(base = 356)]
    pub band09: BandParams,
    #[nested(base = 388)]
    pub band10: BandParams,
    #[nested(base = 420)]
    pub band11: BandParams,
    #[nested(base = 452)]
    pub band12: BandParams,
    #[nested(base = 484)]
    pub band13: BandParams,
    #[nested(base = 516)]
    pub band14: BandParams,
    #[nested(base = 548)]
    pub band15: BandParams,
    #[nested(base = 580)]
    pub band16: BandParams,
    #[nested(base = 612)]
    pub band17: BandParams,
    #[nested(base = 644)]
    pub band18: BandParams,
    #[nested(base = 676)]
    pub band19: BandParams,
    #[nested(base = 708)]
    pub band20: BandParams,
    #[nested(base = 740)]
    pub band21: BandParams,
    #[nested(base = 772)]
    pub band22: BandParams,
    #[nested(base = 804)]
    pub band23: BandParams,
    #[nested(base = 836)]
    pub band24: BandParams,
}

pub const SHAPES: [EqShape; 10] = [
    EqShape::Bell,
    EqShape::LowShelf,
    EqShape::HighShelf,
    EqShape::LowCut,
    EqShape::HighCut,
    EqShape::Notch,
    EqShape::BandPass,
    EqShape::TiltShelf,
    EqShape::FlatTilt,
    EqShape::AllPass,
];
pub const CHANNELS: [EqChannel; 5] = [
    EqChannel::Stereo,
    EqChannel::Left,
    EqChannel::Right,
    EqChannel::Mid,
    EqChannel::Side,
];
pub const MODES: [ProcessingMode; 3] = [
    ProcessingMode::ZeroLatency,
    ProcessingMode::NaturalPhase,
    ProcessingMode::LinearPhase,
];
pub const RESOLUTIONS: [LinearPhaseResolution; 5] = [
    LinearPhaseResolution::Low,
    LinearPhaseResolution::Medium,
    LinearPhaseResolution::High,
    LinearPhaseResolution::VeryHigh,
    LinearPhaseResolution::Maximum,
];

impl EqParams {
    pub fn bands(&self) -> [&BandParams; MAX_EQ_BANDS] {
        [
            &self.band01,
            &self.band02,
            &self.band03,
            &self.band04,
            &self.band05,
            &self.band06,
            &self.band07,
            &self.band08,
            &self.band09,
            &self.band10,
            &self.band11,
            &self.band12,
            &self.band13,
            &self.band14,
            &self.band15,
            &self.band16,
            &self.band17,
            &self.band18,
            &self.band19,
            &self.band20,
            &self.band21,
            &self.band22,
            &self.band23,
            &self.band24,
        ]
    }

    /// UI/worker snapshot. Allocate only outside the audio callback.
    pub fn snapshot(&self) -> EqConfig {
        let mut config = EqConfig {
            bands: Vec::with_capacity(MAX_EQ_BANDS),
            ..EqConfig::default()
        };
        self.fill_config_rt(&mut config);
        config
    }

    /// Caller preallocates the 24-element vector before processing starts.
    pub fn fill_config_rt(&self, config: &mut EqConfig) {
        let slots = self.bands();
        config.bands.clear();
        config.output_gain_db = self.output_gain.raw_target();
        config.bypass = self.bypass.value();
        config.processing_mode = MODES[self.processing_mode.value_usize().min(2)];
        config.linear_phase_resolution =
            RESOLUTIONS[self.linear_phase_resolution.value_usize().min(4)];
        for (index, params) in slots.iter().enumerate() {
            if !params.present.value() {
                continue;
            }
            config.bands.push(EqBand {
                id: index as u32 + 1,
                enabled: params.enabled.value(),
                shape: SHAPES[params.shape.value_usize().min(9)],
                frequency_hz: params.frequency.raw_target(),
                gain_db: params.gain.raw_target(),
                q: params.q.raw_target(),
                slope_db_oct: params.slope.raw_target(),
                channel: CHANNELS[params.channel.value_usize().min(4)],
            });
        }
        config
            .bands
            .sort_unstable_by_key(|band| (slots[(band.id - 1) as usize].order.value(), band.id));
    }

    pub fn normalized_values(&self, config: &EqConfig) -> Vec<(u32, f64)> {
        normalized_values(config)
    }
}

/// Complete fixed-slot values. Deleted slots clear Present while bypassed bands
/// retain Present, preserving their identity and automation on recall.
pub fn normalized_values(config: &EqConfig) -> Vec<(u32, f64)> {
    let infos = EqParams::param_infos_static();
    let mut plain = vec![
        (0, config.output_gain_db),
        (1, f64::from(config.bypass)),
        (
            2,
            MODES
                .iter()
                .position(|mode| *mode == config.processing_mode)
                .unwrap_or(0) as f64,
        ),
        (
            7,
            RESOLUTIONS
                .iter()
                .position(|resolution| *resolution == config.linear_phase_resolution)
                .unwrap_or(2) as f64,
        ),
    ];
    for index in 0..MAX_EQ_BANDS {
        let id = index as u32 + 1;
        let band = config.bands.iter().find(|band| band.id == id);
        let value = band.copied().unwrap_or_default();
        let base = BAND_BASE + index as u32 * BAND_STRIDE;
        let values = [
            f64::from(band.is_some()),
            f64::from(value.enabled),
            SHAPES
                .iter()
                .position(|shape| *shape == value.shape)
                .unwrap_or(0) as f64,
            value.frequency_hz,
            value.gain_db,
            value.q,
            value.slope_db_oct,
            CHANNELS
                .iter()
                .position(|channel| *channel == value.channel)
                .unwrap_or(0) as f64,
        ];
        plain.extend(
            values
                .into_iter()
                .enumerate()
                .map(|(offset, value)| (base + offset as u32, value)),
        );
        plain.push((
            base + 19,
            config
                .bands
                .iter()
                .position(|band| band.id == id)
                .unwrap_or(0) as f64,
        ));
    }
    plain
        .into_iter()
        .filter_map(|(id, value)| {
            infos
                .iter()
                .find(|info| info.id == id)
                .map(|info| (id, info.range.normalize(value)))
        })
        .collect()
}
