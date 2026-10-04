use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginAnalysisSettings {
    pub sample_rate: u32,
    pub block_size: u32,
    pub level_dbfs: f64,
    pub start_hz: f64,
    pub end_hz: f64,
    pub sweep_seconds: f64,
    pub tail_seconds: f64,
    pub tone_hz: f64,
    pub model_order: u32,
    pub mid_side: bool,
}

impl PluginAnalysisSettings {
    pub fn valid(&self) -> bool {
        matches!(self.sample_rate, 44100 | 48000 | 88200 | 96000)
            && matches!(self.block_size, 64 | 128 | 256 | 512 | 1024)
            && self.level_dbfs.is_finite()
            && (-60.0..=12.0).contains(&self.level_dbfs)
            && self.start_hz.is_finite()
            && self.end_hz.is_finite()
            && self.start_hz >= 10.0
            && self.end_hz > self.start_hz * 2.0
            && self.end_hz <= f64::from(self.sample_rate) * 0.45
            && self.sweep_seconds.is_finite()
            && (1.0..=8.0).contains(&self.sweep_seconds)
            && self.tail_seconds.is_finite()
            && (0.25..=5.0).contains(&self.tail_seconds)
            && self.tone_hz.is_finite()
            && self.tone_hz >= 20.0
            && self.tone_hz <= f64::from(self.sample_rate) * 0.45
            && (3..=7).contains(&self.model_order)
    }
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginAnalysisResponse {
    pub input: u32,
    pub output: u32,
    pub frequency_hz: Vec<f64>,
    pub magnitude_db: Vec<f64>,
    pub phase_degrees: Vec<Option<f64>>,
    pub impulse: Vec<f64>,
    pub impulse_stride: u32,
    pub impulse_start_samples: i32,
    pub delay_samples: Option<u32>,
    pub tail_truncated: bool,
    pub silence_rms: f64,
    pub repeat_error_percent: f64,
}

/// H2 through H8 in orders_db are dB relative to the measured fundamental; null above Nyquist.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginAnalysisHarmonics {
    pub channel: u32,
    pub frequency_hz: Vec<f64>,
    pub orders_db: Vec<Vec<Option<f64>>>,
    pub thd_percent: Vec<Option<f64>>,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginAnalysisModel {
    pub channel: u32,
    pub coefficients: Vec<f64>,
    pub input_scale: f64,
    pub filter: Vec<f64>,
    pub delay_samples: u32,
    pub validation_error_percent: f64,
    pub suitable: bool,
    pub predicted: Vec<f64>,
    pub observed: Vec<f64>,
    pub validation_stride: u32,
}

/// magnitude_dbfs is a column-major Hann-windowed output spectrum, peak dBFS, floor -160 dBFS.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginAnalysisSpectrogram {
    pub channel: u32,
    pub logarithmic_sweep: bool,
    pub columns: u32,
    pub rows: u32,
    pub duration_seconds: f64,
    pub maximum_frequency_hz: f64,
    pub magnitude_dbfs: Vec<f32>,
}

/// Single-tone THD/THD+N and two-tone intermodulation distortion.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginAnalysisDistortion {
    pub channel: u32,
    pub tone_hz: f64,
    pub thd_percent: Option<f64>,
    pub thd_plus_n_percent: Option<f64>,
    pub imd_percent: Option<f64>,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginAnalysisPerformance {
    pub reported_latency_samples: u32,
    pub average_block_us: f64,
    pub p95_block_us: f64,
    pub p99_block_us: f64,
    pub maximum_block_us: f64,
    pub budget_us: f64,
    pub deadline_misses: u32,
    pub measured_blocks: u32,
    pub buffer_bytes: u64,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginAnalysisReport {
    pub settings: PluginAnalysisSettings,
    pub responses: Vec<PluginAnalysisResponse>,
    pub harmonics: Vec<PluginAnalysisHarmonics>,
    pub spectrograms: Vec<PluginAnalysisSpectrogram>,
    pub distortion: Vec<PluginAnalysisDistortion>,
    pub models: Vec<PluginAnalysisModel>,
    pub performance: PluginAnalysisPerformance,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginAnalysisFailure {
    InvalidSettings,
    MissingProcessor,
    ProcessorRejected,
    InvalidOutput,
    Cancelled,
    WorkerUnavailable,
    Busy,
    MissingJob,
}

#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum PluginAnalysisJobStatus {
    Running { phase: String, progress: f64 },
    Completed { report: Box<PluginAnalysisReport> },
    Failed { failure: PluginAnalysisFailure },
}
