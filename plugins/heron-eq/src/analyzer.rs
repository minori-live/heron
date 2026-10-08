//! Off-callback FFT analysis and presentation. Raw power remains available for
//! EQ Match; smoothing and frequency tilt only change the display snapshot.

use crate::telemetry::SpectrumSnapshot;
use heron_dsp_core::eq::EqChannel;
use rustfft::{Fft, FftPlanner, num_complex::Complex32};
use std::sync::Arc;

pub const DISPLAY_BINS: usize = 512;
pub const ANALYZER_RING_CAPACITY: usize = 32768;

// Presentation only: a symmetric 1/6-octave Gaussian FWHM rounds noise and
// narrow peaks on the logarithmic display grid. Raw Match data is unchanged.
const DISPLAY_SMOOTHING_OCTAVES: f32 = 1.0 / 6.0;
const SPATIAL_RADIUS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AnalyzerResolution {
    Low,
    Medium,
    #[default]
    High,
    Maximum,
}
impl AnalyzerResolution {
    pub fn fft_size(self) -> usize {
        match self {
            Self::Low => 1024,
            Self::Medium => 2048,
            Self::High => 4096,
            Self::Maximum => 8192,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AnalyzerSpeed {
    Off,
    Fast,
    #[default]
    Medium,
    Slow,
}
impl AnalyzerSpeed {
    pub fn seconds(self) -> f64 {
        match self {
            Self::Off => 0.0,
            Self::Fast => 0.05,
            Self::Medium => 0.2,
            Self::Slow => 0.8,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnalyzerConfig {
    pub resolution: AnalyzerResolution,
    pub speed: AnalyzerSpeed,
    pub tilt_db_oct: f32,
    pub channel: EqChannel,
}
impl Default for AnalyzerConfig {
    fn default() -> Self {
        Self {
            resolution: AnalyzerResolution::High,
            speed: AnalyzerSpeed::Medium,
            tilt_db_oct: 0.0,
            channel: EqChannel::Stereo,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalyzerError {
    InvalidTilt,
    InvalidSampleRate,
}

pub struct SpectrumAnalyzer {
    config: AnalyzerConfig,
    fft: Arc<dyn Fft<f32>>,
    inputs: [Vec<Complex32>; 6],
    pending_inputs: [Vec<Complex32>; 6],
    scratch: Vec<Complex32>,
    window: Vec<f32>,
    window_gain: f32,
    window_energy: f32,
    raw: SpectrumSnapshot,
    display: SpectrumSnapshot,
    smoothed_power: [[f32; DISPLAY_BINS]; 3],
    smoothing_initialized: bool,
    rms_db: [f32; 3],
    head: u64,
}

impl Default for SpectrumAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

impl SpectrumAnalyzer {
    pub fn new() -> Self {
        Self::with_config(AnalyzerConfig::default())
    }

    fn with_config(config: AnalyzerConfig) -> Self {
        let size = config.resolution.fft_size();
        let fft = FftPlanner::<f32>::new().plan_fft_forward(size);
        let window: Vec<_> = (0..size)
            .map(|index| 0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / size as f32).cos())
            .collect();
        Self {
            config,
            scratch: vec![Complex32::default(); fft.get_inplace_scratch_len()],
            fft,
            inputs: std::array::from_fn(|_| vec![Complex32::default(); size]),
            pending_inputs: std::array::from_fn(|_| vec![Complex32::default(); size]),
            window_gain: 2.0 / window.iter().sum::<f32>(),
            window_energy: window.iter().map(|value| value * value).sum(),
            window,
            raw: SpectrumSnapshot::default(),
            display: SpectrumSnapshot::default(),
            smoothed_power: [[0.0; DISPLAY_BINS]; 3],
            smoothing_initialized: false,
            rms_db: [-120.0; 3],
            head: 0,
        }
    }

    /// Must be called on the analysis/editor thread; a size change prepares a
    /// new FFT and all buffers here, before any window is measured.
    pub fn configure(&mut self, config: AnalyzerConfig) -> Result<(), AnalyzerError> {
        if !config.tilt_db_oct.is_finite() || !(-12.0..=12.0).contains(&config.tilt_db_oct) {
            return Err(AnalyzerError::InvalidTilt);
        }
        if config.resolution != self.config.resolution {
            let sample_rate = self.raw.sample_rate;
            let head = self.head;
            *self = Self::with_config(config);
            self.raw.sample_rate = sample_rate;
            self.display.sample_rate = sample_rate;
            self.head = head.saturating_sub(self.hop_samples() as u64);
        } else {
            let refresh_power =
                config.channel != self.config.channel || config.speed == AnalyzerSpeed::Off;
            self.config = config;
            if refresh_power {
                for (index, frequency) in self.raw.frequency_hz.iter().copied().enumerate() {
                    let powers =
                        self.display_powers_at(frequency, self.raw.sample_rate, config.channel);
                    for (pair, power) in powers.into_iter().enumerate() {
                        self.smoothed_power[pair][index] = power;
                    }
                }
            }
            self.refresh_display();
        }
        Ok(())
    }

    pub fn config(&self) -> AnalyzerConfig {
        self.config
    }
    pub fn fft_size(&self) -> usize {
        self.config.resolution.fft_size()
    }
    pub fn hop_samples(&self) -> usize {
        self.fft_size() / 4
    }
    pub fn last_head(&self) -> u64 {
        self.head
    }
    pub fn sample_rate(&self) -> f64 {
        self.raw.sample_rate
    }
    pub fn rms_db(&self) -> [f32; 3] {
        self.rms_db
    }

    pub fn reset_sample_rate(
        &mut self,
        sample_rate: f64,
        rate_change_head: u64,
    ) -> Result<(), AnalyzerError> {
        if !sample_rate.is_finite() || !(8000.0..=384000.0).contains(&sample_rate) {
            return Err(AnalyzerError::InvalidSampleRate);
        }
        if self.raw.sample_rate != sample_rate {
            self.raw = SpectrumSnapshot {
                sample_rate,
                ..SpectrumSnapshot::default()
            };
            self.display = self.raw.clone();
            self.head = rate_change_head;
            self.smoothing_initialized = false;
            self.smoothed_power.fill([0.0; DISPLAY_BINS]);
            self.rms_db = [-120.0; 3];
        }
        Ok(())
    }

    pub fn ready(&self, head: u64, rate_change_head: u64) -> bool {
        head.saturating_sub(rate_change_head) >= self.fft_size() as u64
            && head.saturating_sub(self.head) >= self.hop_samples() as u64
    }

    /// Read a validated, coherent window from the bounded sample ring. A reader
    /// must return None when a slot was overwritten; failed windows leave all
    /// last-good raw and display values intact and increment invalid_windows.
    pub fn capture_window(
        &mut self,
        head: u64,
        sample_rate: f64,
        mut read: impl FnMut(u64) -> Option<[f32; 6]>,
    ) -> bool {
        if !sample_rate.is_finite()
            || !(8000.0..=384000.0).contains(&sample_rate)
            || head < self.fft_size() as u64
        {
            return false;
        }
        let size = self.fft_size();
        for offset in 0..size {
            let sequence = head - size as u64 + offset as u64;
            let Some(frame) = read(sequence) else {
                self.raw.invalid_windows += 1;
                self.display.invalid_windows = self.raw.invalid_windows;
                return false;
            };
            for (channel, value) in frame.into_iter().enumerate() {
                let value = if value.is_finite() { value } else { 0.0 };
                self.pending_inputs[channel][offset] =
                    Complex32::new(value * self.window[offset], 0.0);
            }
        }
        // A failed ring read must preserve the last coherent FFT: display
        // channel/Speed Off changes can project it without another capture.
        std::mem::swap(&mut self.inputs, &mut self.pending_inputs);
        self.compute(head, sample_rate);
        true
    }

    pub fn raw_snapshot(&self) -> SpectrumSnapshot {
        self.raw.clone()
    }
    pub fn display_snapshot(&self) -> SpectrumSnapshot {
        self.display.clone()
    }

    fn compute(&mut self, head: u64, sample_rate: f64) {
        let size = self.fft_size();
        for input in &mut self.inputs {
            self.fft.process_with_scratch(input, &mut self.scratch);
        }
        self.raw.frequency_hz.clear();
        let max_frequency = (sample_rate as f32 * 0.499).min(30000.0);
        let elapsed = head.saturating_sub(self.head) as f64 / sample_rate;
        let smoothing = if self.config.speed == AnalyzerSpeed::Off || !self.smoothing_initialized {
            0.0
        } else {
            (-elapsed / self.config.speed.seconds()).exp() as f32
        };
        for display in 0..DISPLAY_BINS {
            let frequency =
                10.0 * (max_frequency / 10.0).powf(display as f32 / (DISPLAY_BINS - 1) as f32);
            self.raw.frequency_hz.push(frequency);
            let powers = self.projected_powers_at(frequency, sample_rate, EqChannel::Stereo);
            self.raw.pre_db[display] = db(powers[0]);
            self.raw.post_db[display] = db(powers[1]);
            self.raw.external_db[display] = db(powers[2]);
            let display_power = self.display_powers_at(frequency, sample_rate, self.config.channel);
            for (pair, power) in display_power.into_iter().enumerate() {
                self.smoothed_power[pair][display] =
                    smoothing * self.smoothed_power[pair][display] + (1.0 - smoothing) * power;
            }
        }
        for pair in 0..3 {
            let mut energy = 0.0;
            for channel in pair * 2..pair * 2 + 2 {
                let spectrum = &self.inputs[channel];
                let summed = spectrum[0].norm_sqr()
                    + spectrum[size / 2].norm_sqr()
                    + 2.0
                        * spectrum[1..size / 2]
                            .iter()
                            .map(|value| value.norm_sqr())
                            .sum::<f32>();
                energy += summed / (size as f32 * self.window_energy) * 0.5;
            }
            self.rms_db[pair] = db(energy);
        }
        self.raw.overwritten_samples += head
            .saturating_sub(self.head)
            .saturating_sub(ANALYZER_RING_CAPACITY as u64);
        self.head = head;
        self.raw.sequence = head;
        self.raw.sample_rate = sample_rate;
        self.smoothing_initialized = true;
        self.refresh_display();
    }

    fn refresh_display(&mut self) {
        self.display = smoothed_snapshot(&self.raw, &self.smoothed_power, self.config.tilt_db_oct);
    }

    fn fft_bin_powers(&self, bin: usize, channel: EqChannel) -> [f32; 3] {
        std::array::from_fn(|pair| {
            let left = self.inputs[pair * 2][bin];
            let right = self.inputs[pair * 2 + 1][bin];
            let power = match channel {
                EqChannel::Stereo => (left.norm_sqr() + right.norm_sqr()) * 0.5,
                EqChannel::Left => left.norm_sqr(),
                EqChannel::Right => right.norm_sqr(),
                EqChannel::Mid => ((left + right) * 0.5).norm_sqr(),
                EqChannel::Side => ((left - right) * 0.5).norm_sqr(),
            };
            power * self.window_gain * self.window_gain
        })
    }

    fn display_powers_at(&self, frequency: f32, sample_rate: f64, channel: EqChannel) -> [f32; 3] {
        let size = self.fft_size();
        let scale = size as f32 / sample_rate as f32;
        let max_frequency = (sample_rate as f32 * 0.499).min(30000.0);
        let half_width = (max_frequency / 10.0).powf(0.5 / (DISPLAY_BINS - 1) as f32);
        let position = |frequency: f32| (frequency * scale).clamp(0.0, (size / 2 - 1) as f32);
        let interpolate = |bin: f32| {
            let first = bin.floor() as usize;
            let last = (first + 1).min(size / 2 - 1);
            let fraction = bin - first as f32;
            let left = self.fft_bin_powers(first, channel);
            let right = self.fft_bin_powers(last, channel);
            std::array::from_fn::<_, 3, _>(|pair| {
                left[pair] * (1.0 - fraction) + right[pair] * fraction
            })
        };
        let first = position(frequency / half_width);
        let last = position(frequency * half_width);
        let center = interpolate(position(frequency));
        let blend = (last - first - 0.5).clamp(0.0, 1.0);
        if blend == 0.0 {
            // Multiple low display frequencies formerly reused the same
            // rounded FFT bin. Continuous power interpolation removes steps.
            return center;
        }
        let left = interpolate(first);
        let right = interpolate(last);
        let mut peak = std::array::from_fn::<_, 3, _>(|pair| left[pair].max(right[pair]));
        for bin in first.ceil() as usize..=last.floor() as usize {
            let powers = self.fft_bin_powers(bin, channel);
            for pair in 0..3 {
                peak[pair] = peak[pair].max(powers[pair]);
            }
        }
        // Wider log cells retain narrow tones between display frequencies.
        // Edge interpolation and the blend avoid a sampling-mode discontinuity.
        std::array::from_fn(|pair| center[pair] * (1.0 - blend) + peak[pair] * blend)
    }

    fn projected_powers_at(
        &self,
        frequency: f32,
        sample_rate: f64,
        channel: EqChannel,
    ) -> [f32; 3] {
        let size = self.fft_size();
        let max_frequency = (sample_rate as f32 * 0.499).min(30000.0);
        let half_width = (max_frequency / 10.0).powf(0.5 / (DISPLAY_BINS - 1) as f32);
        let bin = |value: f32| value.clamp(1.0, (size / 2 - 1) as f32) as usize;
        let nearest = bin((frequency * size as f32 / sample_rate as f32).round());
        let first = bin((frequency / half_width * size as f32 / sample_rate as f32).ceil());
        let last = bin((frequency * half_width * size as f32 / sample_rate as f32).floor());
        let (first, last) = if first <= last {
            (first, last)
        } else {
            (nearest, nearest)
        };
        // Keep narrow peaks, and project the actual complex L/R transforms so
        // antiphase material can distinguish Mid and Side without changing raw EQ Match data.
        (first..=last).fold([0.0; 3], |mut peak, bin| {
            let powers = self.fft_bin_powers(bin, channel);
            for pair in 0..3 {
                peak[pair] = peak[pair].max(powers[pair]);
            }
            peak
        })
    }
}

fn smoothed_snapshot(
    raw: &SpectrumSnapshot,
    smoothed_power: &[[f32; DISPLAY_BINS]; 3],
    tilt_db_oct: f32,
) -> SpectrumSnapshot {
    let mut display = raw.clone();
    let frequencies = &raw.frequency_hz;
    if frequencies.len() < 2 {
        return display;
    }
    let octave_step = (frequencies[frequencies.len() - 1] / frequencies[0]).log2()
        / (frequencies.len() - 1) as f32;
    let sigma = DISPLAY_SMOOTHING_OCTAVES / 2.354_82;
    let weights: [f32; SPATIAL_RADIUS * 2 + 1] = std::array::from_fn(|index| {
        let distance = (index as f32 - SPATIAL_RADIUS as f32) * octave_step / sigma;
        (-0.5 * distance * distance).exp()
    });
    for (index, frequency) in frequencies.iter().copied().enumerate() {
        let mut power = [0.0; 3];
        let mut total_weight = 0.0;
        for (neighbor, weight) in weights.iter().copied().enumerate() {
            let source = index as isize + neighbor as isize - SPATIAL_RADIUS as isize;
            if !(0..frequencies.len() as isize).contains(&source) {
                continue;
            }
            total_weight += weight;
            for (pair, sum) in power.iter_mut().enumerate() {
                *sum += weight * smoothed_power[pair][source as usize];
            }
        }
        let tilt = tilt_db_oct * (frequency / 1000.0).log2();
        display.pre_db[index] = db(power[0] / total_weight) + tilt;
        display.post_db[index] = db(power[1] / total_weight) + tilt;
        display.external_db[index] = db(power[2] / total_weight) + tilt;
    }
    display
}

fn db(power: f32) -> f32 {
    10.0 * power.max(1.0e-12).log10()
}

#[cfg(test)]
mod tests;
