use serde::{Deserialize, Serialize};
use std::{error::Error, fmt};

/// Maximum number of simultaneously enabled EQ bands per instance.
pub const MAX_EQ_BANDS: usize = 24;

/// Finite serialization marker for a linear-phase steep-cut design.
pub const BRICKWALL_SLOPE: f64 = 1000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum LinearPhaseResolution {
    Low,
    Medium,
    #[default]
    High,
    VeryHigh,
    Maximum,
}
impl LinearPhaseResolution {
    pub fn taps(self) -> usize {
        match self {
            Self::Low => 513,
            Self::Medium => 1025,
            Self::High => 2049,
            Self::VeryHigh => 4097,
            Self::Maximum => 8193,
        }
    }
    pub fn latency_samples(self) -> usize {
        self.taps() / 2 + super::convolution::BLOCK
    }
}

/// Supported native transfer shapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum EqShape {
    #[default]
    Bell,
    LowShelf,
    HighShelf,
    LowCut,
    HighCut,
    Notch,
    BandPass,
    TiltShelf,
    FlatTilt,
    AllPass,
}

/// Orthogonal channel projections supported by each band.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum EqChannel {
    #[default]
    Stereo,
    Left,
    Right,
    Mid,
    Side,
}

/// Real audio processing modes, each with an explicit reported latency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ProcessingMode {
    #[default]
    ZeroLatency,
    /// Two-times oversampling with symmetric reconstruction/antialias FIRs.
    NaturalPhase,
    /// Symmetric FIR with selectable resolution and partitioned FFT convolution.
    LinearPhase,
}

/// Stable identity and editable parameters of a native band.
/// Unknown legacy fields are ignored; only these static parameters are restored.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EqBand {
    pub id: u32,
    pub enabled: bool,
    pub shape: EqShape,
    pub frequency_hz: f64,
    pub gain_db: f64,
    pub q: f64,
    pub slope_db_oct: f64,
    pub channel: EqChannel,
}

impl Default for EqBand {
    fn default() -> Self {
        Self {
            id: 0,
            enabled: true,
            shape: EqShape::Bell,
            frequency_hz: 1000.0,
            gain_db: 0.0,
            q: std::f64::consts::FRAC_1_SQRT_2,
            slope_db_oct: 12.0,
            channel: EqChannel::Stereo,
        }
    }
}

impl EqBand {
    /// Validate parameters before allocating or changing any processor state.
    pub fn validate(&self, sample_rate: f64) -> Result<(), EqError> {
        if !sample_rate.is_finite() || !(8000.0..=384000.0).contains(&sample_rate) {
            return Err(EqError::SampleRateOutOfRange);
        }
        if !self.frequency_hz.is_finite()
            || self.frequency_hz < 1.0
            || self.frequency_hz >= sample_rate * 0.499
        {
            return Err(EqError::FrequencyOutOfRange);
        }
        if !self.gain_db.is_finite() || self.gain_db.abs() > 36.0 {
            return Err(EqError::GainOutOfRange);
        }
        if !self.q.is_finite() || !(0.025..=40.0).contains(&self.q) {
            return Err(EqError::QOutOfRange);
        }
        let cut = matches!(
            self.shape,
            EqShape::LowCut | EqShape::HighCut | EqShape::BandPass
        );
        let minimum = if matches!(self.shape, EqShape::Bell | EqShape::Notch) {
            12.0
        } else {
            6.0
        };
        if !self.slope_db_oct.is_finite()
            || (!(minimum..=96.0).contains(&self.slope_db_oct)
                && !(cut
                    && ((0.0..=96.0).contains(&self.slope_db_oct)
                        || self.slope_db_oct == BRICKWALL_SLOPE)))
        {
            return Err(EqError::SlopeOutOfRange);
        }
        Ok(())
    }
}

/// Persistable instance state; empty bands represent a transparent equalizer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct EqConfig {
    pub bands: Vec<EqBand>,
    pub output_gain_db: f64,
    pub bypass: bool,
    pub processing_mode: ProcessingMode,
    #[serde(default)]
    pub linear_phase_resolution: LinearPhaseResolution,
}

impl EqConfig {
    pub fn validate(&self, sample_rate: f64) -> Result<(), EqError> {
        if !sample_rate.is_finite() || !(8000.0..=384000.0).contains(&sample_rate) {
            return Err(EqError::SampleRateOutOfRange);
        }
        if self.bands.len() > MAX_EQ_BANDS {
            return Err(EqError::TooManyBands);
        }
        if !self.output_gain_db.is_finite() || self.output_gain_db.abs() > 60.0 {
            return Err(EqError::GainOutOfRange);
        }
        for (index, band) in self.bands.iter().enumerate() {
            band.validate(sample_rate)?;
            if band.slope_db_oct == BRICKWALL_SLOPE
                && self.processing_mode != ProcessingMode::LinearPhase
            {
                return Err(EqError::BrickwallRequiresLinearPhase);
            }
            if self.bands[..index].iter().any(|other| other.id == band.id) {
                return Err(EqError::DuplicateBandId);
            }
        }
        Ok(())
    }
}

/// Typed local DSP errors. No failed update changes the active audio state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EqError {
    SampleRateOutOfRange,
    FrequencyOutOfRange,
    GainOutOfRange,
    QOutOfRange,
    SlopeOutOfRange,
    TooManyBands,
    DuplicateBandId,
    RequiresPreparation,
    BrickwallRequiresLinearPhase,
}

impl fmt::Display for EqError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "equalizer validation failed: {self:?}")
    }
}
impl Error for EqError {}
