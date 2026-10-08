use std::fmt;

use heron_dsp_core::eq::{EqChannel, EqShape, LinearPhaseResolution, ProcessingMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape(pub EqShape);

impl fmt::Display for Shape {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.0 {
            EqShape::Bell => "Bell",
            EqShape::LowShelf => "Low shelf",
            EqShape::HighShelf => "High shelf",
            EqShape::LowCut => "Low cut",
            EqShape::HighCut => "High cut",
            EqShape::Notch => "Notch",
            EqShape::BandPass => "Band pass",
            EqShape::TiltShelf => "Tilt shelf",
            EqShape::FlatTilt => "Flat tilt",
            EqShape::AllPass => "All pass",
        })
    }
}

pub const SHAPES: [Shape; 10] = [
    Shape(EqShape::Bell),
    Shape(EqShape::LowShelf),
    Shape(EqShape::HighShelf),
    Shape(EqShape::LowCut),
    Shape(EqShape::HighCut),
    Shape(EqShape::Notch),
    Shape(EqShape::BandPass),
    Shape(EqShape::TiltShelf),
    Shape(EqShape::FlatTilt),
    Shape(EqShape::AllPass),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Channel(pub EqChannel);

impl fmt::Display for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.0 {
            EqChannel::Stereo => "Stereo",
            EqChannel::Left => "Left",
            EqChannel::Right => "Right",
            EqChannel::Mid => "Mid",
            EqChannel::Side => "Side",
        })
    }
}

pub const CHANNELS: [Channel; 5] = [
    Channel(EqChannel::Stereo),
    Channel(EqChannel::Left),
    Channel(EqChannel::Right),
    Channel(EqChannel::Mid),
    Channel(EqChannel::Side),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mode(pub ProcessingMode);

impl fmt::Display for Mode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.0 {
            ProcessingMode::ZeroLatency => "Zero latency",
            ProcessingMode::NaturalPhase => "Natural phase",
            ProcessingMode::LinearPhase => "Linear phase",
        })
    }
}

pub const MODES: [Mode; 3] = [
    Mode(ProcessingMode::ZeroLatency),
    Mode(ProcessingMode::NaturalPhase),
    Mode(ProcessingMode::LinearPhase),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Slope(pub u16);
impl fmt::Display for Slope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0 == 1000 {
            f.write_str("Brickwall")
        } else {
            write!(f, "{} dB/oct", self.0)
        }
    }
}
pub const SLOPES: [Slope; 11] = [
    Slope(0),
    Slope(6),
    Slope(12),
    Slope(18),
    Slope(24),
    Slope(30),
    Slope(36),
    Slope(48),
    Slope(72),
    Slope(96),
    Slope(1000),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resolution(pub LinearPhaseResolution);
impl fmt::Display for Resolution {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.0 {
            LinearPhaseResolution::Low => "Low",
            LinearPhaseResolution::Medium => "Medium",
            LinearPhaseResolution::High => "High",
            LinearPhaseResolution::VeryHigh => "Very high",
            LinearPhaseResolution::Maximum => "Maximum",
        })
    }
}
pub const RESOLUTIONS: [Resolution; 5] = [
    Resolution(LinearPhaseResolution::Low),
    Resolution(LinearPhaseResolution::Medium),
    Resolution(LinearPhaseResolution::High),
    Resolution(LinearPhaseResolution::VeryHigh),
    Resolution(LinearPhaseResolution::Maximum),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range(pub u8);
impl fmt::Display for Range {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "±{} dB", self.0)
    }
}
pub const RANGES: [Range; 4] = [Range(3), Range(6), Range(12), Range(30)];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PanMode(pub u8);
impl fmt::Display for PanMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(if self.0 == 0 { "L/R pan" } else { "M/S pan" })
    }
}
pub const PAN_MODES: [PanMode; 2] = [PanMode(0), PanMode(1)];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FftSize(pub crate::analyzer::AnalyzerResolution);
impl fmt::Display for FftSize {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.0 {
            crate::analyzer::AnalyzerResolution::Low => "1024",
            crate::analyzer::AnalyzerResolution::Medium => "2048",
            crate::analyzer::AnalyzerResolution::High => "4096",
            crate::analyzer::AnalyzerResolution::Maximum => "8192",
        })
    }
}
pub const FFT_SIZES: [FftSize; 4] = [
    FftSize(crate::analyzer::AnalyzerResolution::Low),
    FftSize(crate::analyzer::AnalyzerResolution::Medium),
    FftSize(crate::analyzer::AnalyzerResolution::High),
    FftSize(crate::analyzer::AnalyzerResolution::Maximum),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Speed(pub crate::analyzer::AnalyzerSpeed);
impl fmt::Display for Speed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.0 {
            crate::analyzer::AnalyzerSpeed::Off => "Off",
            crate::analyzer::AnalyzerSpeed::Fast => "Fast",
            crate::analyzer::AnalyzerSpeed::Medium => "Medium",
            crate::analyzer::AnalyzerSpeed::Slow => "Slow",
        })
    }
}
pub const SPEEDS: [Speed; 4] = [
    Speed(crate::analyzer::AnalyzerSpeed::Off),
    Speed(crate::analyzer::AnalyzerSpeed::Fast),
    Speed(crate::analyzer::AnalyzerSpeed::Medium),
    Speed(crate::analyzer::AnalyzerSpeed::Slow),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpectrumFloor(pub u16);
impl fmt::Display for SpectrumFloor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} dB", self.0)
    }
}
pub const FLOORS: [SpectrumFloor; 3] = [SpectrumFloor(90), SpectrumFloor(120), SpectrumFloor(180)];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MidiTarget {
    pub id: u32,
    pub label: String,
}
impl fmt::Display for MidiTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.label)
    }
}

pub fn midi_targets(params: &crate::params::EqParams, band_id: u32) -> Vec<MidiTarget> {
    let base = crate::params::BAND_BASE + (band_id - 1) * crate::params::BAND_STRIDE;
    let globals = [
        (0, "Output"),
        (1, "Bypass EQ"),
        (2, "Processing mode"),
        (3, "Gain scale"),
        (4, "Invert phase"),
        (5, "Auto gain"),
        (7, "Linear resolution"),
        (8, "Output pan"),
        (9, "Pan mode"),
        (10, "Output mute"),
    ];
    let band = [
        "Enabled",
        "Shape",
        "Frequency",
        "Gain",
        "Q",
        "Response / cut slope",
        "Channel",
    ];
    globals
        .into_iter()
        .chain(
            band.into_iter()
                .enumerate()
                .map(|(index, label)| (base + index as u32 + 1, label)),
        )
        .map(|(id, label)| MidiTarget {
            id,
            label: params
                .midi_bindings
                .controller_for(id)
                .map_or_else(|| label.to_owned(), |cc| format!("{label} · CC {cc}")),
        })
        .collect()
}
