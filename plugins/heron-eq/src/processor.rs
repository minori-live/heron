//! Plugin lifecycle and audio pipeline composition.
use crate::{
    params::EqParams,
    preparation::{PreparationWorker, Prepared},
};
use heron_dsp_core::eq::{EqBand, EqConfig, EqProcessor, MAX_EQ_BANDS};
use truce::prelude::*;

pub struct EqDspState {
    active: Option<Box<Prepared>>,
    staged: Option<Box<Prepared>>,
    warmup: usize,
    fade: usize,
    worker: Option<PreparationWorker>,
    config: EqConfig,
    candidate: EqConfig,
    requested: EqConfig,
    sample_rate: f64,
    solo: SoloFilter,
    gain: f32,
    input_energy: f64,
    output_energy: f64,
    auto_gain: f32,
    dry_history: Box<[[f32; 2]]>,
    solo_history: Box<[[f32; 2]]>,
    dry_cursor: usize,
    wet: f32,
    settings: OutputSettings,
    semantic_valid: bool,
    pan: crate::output_pan::OutputPan,
    mute_gain: f32,
}

#[derive(Clone, Copy)]
struct OutputSettings {
    gain: f32,
    gain_scale: f64,
    bypass: bool,
    auto_gain: bool,
    phase_invert: bool,
    pan: f64,
    pan_mode: u8,
    mute: bool,
}
impl Default for OutputSettings {
    fn default() -> Self {
        Self {
            gain: 1.0,
            gain_scale: 1.0,
            bypass: false,
            auto_gain: false,
            phase_invert: false,
            pan: 0.0,
            pan_mode: 0,
            mute: false,
        }
    }
}
impl OutputSettings {
    fn read(params: &EqParams) -> Self {
        Self {
            gain: 10.0f32.powf(params.output_gain.raw_target() as f32 / 20.0),
            gain_scale: params.gain_scale.raw_target(),
            bypass: params.bypass.value(),
            auto_gain: params.auto_gain.value(),
            phase_invert: params.phase_invert.value(),
            pan: params.output_pan.raw_target(),
            pan_mode: params.output_pan_mode.value() as u8,
            mute: params.output_mute.value(),
        }
    }
}

impl Default for EqDspState {
    fn default() -> Self {
        Self {
            active: None,
            staged: None,
            warmup: 0,
            fade: 0,
            worker: None,
            config: EqConfig {
                bands: Vec::with_capacity(MAX_EQ_BANDS),
                ..EqConfig::default()
            },
            candidate: EqConfig {
                bands: Vec::with_capacity(MAX_EQ_BANDS),
                ..EqConfig::default()
            },
            requested: EqConfig {
                bands: Vec::with_capacity(MAX_EQ_BANDS),
                ..EqConfig::default()
            },
            sample_rate: 44100.0,
            solo: SoloFilter::default(),
            gain: 1.0,
            input_energy: 0.0,
            output_energy: 0.0,
            auto_gain: 1.0,
            dry_history: vec![[0.0; 2]; 16384].into_boxed_slice(),
            solo_history: vec![[0.0; 2]; 16384].into_boxed_slice(),
            dry_cursor: 0,
            wet: 1.0,
            settings: OutputSettings::default(),
            semantic_valid: true,
            pan: crate::output_pan::OutputPan::new(44100.0, 0.0, 0, true),
            mute_gain: 1.0,
        }
    }
}

impl EqDspState {
    pub fn reset(&mut self, params: &EqParams, sample_rate: f64) {
        self.worker = None;
        self.staged = None;
        self.warmup = 0;
        self.fade = 0;
        self.sample_rate = sample_rate;
        params.telemetry.set_sample_rate(sample_rate);
        let previous_settings = self.settings;
        if self.read_parameters(params) {
            self.prepare_config();
        }
        let processor = self
            .semantic_valid
            .then(|| EqProcessor::prepare(&self.config, sample_rate).ok())
            .flatten();
        let failed = processor.is_none();
        let processor = processor.or_else(|| {
            self.settings = previous_settings;
            EqProcessor::prepare(&EqConfig::default(), sample_rate).ok()
        });
        self.active = processor.map(|processor| {
            let response = crate::response::prepare_response(&processor, sample_rate, 0);
            Box::new(Prepared::new(processor, response, 0))
        });
        if let Some(active) = &self.active {
            params
                .telemetry
                .publish_active_response_rt(&active.response);
            params
                .telemetry
                .publish_active_config_rt(active.processor.active_config());
        } else {
            params.telemetry.clear_active_metadata();
        }
        params
            .telemetry
            .publish_processing(false, if failed { 2 } else { 0 });
        self.worker = Some(PreparationWorker::start(sample_rate));
        self.solo = SoloFilter::default();
        self.gain = self.settings.gain;
        self.input_energy = 0.0;
        self.output_energy = 0.0;
        self.auto_gain = 1.0;
        self.dry_history.fill([0.0; 2]);
        self.solo_history.fill([0.0; 2]);
        self.dry_cursor = 0;
        self.wet = if self.settings.bypass { 0.0 } else { 1.0 };
        self.mute_gain = if self.settings.mute { 0.0 } else { 1.0 };
        self.pan = crate::output_pan::OutputPan::new(
            sample_rate,
            self.settings.pan,
            self.settings.pan_mode,
            true,
        );
    }

    fn read_parameters(&mut self, params: &EqParams) -> bool {
        let before = params.telemetry.parameter_epoch();
        if !before.is_multiple_of(2) {
            return false;
        }
        params.fill_config_rt(&mut self.candidate);
        let settings = OutputSettings::read(params);
        std::sync::atomic::fence(std::sync::atomic::Ordering::Acquire);
        if before != params.telemetry.parameter_epoch() {
            return false;
        }
        std::mem::swap(&mut self.config, &mut self.candidate);
        self.settings = settings;
        true
    }

    fn prepare_config(&mut self) {
        self.config.output_gain_db = 0.0;
        // Global bypass lives at the outermost, latency-compensated boundary.
        // Every inner state keeps running so resuming never opens empty history.
        self.config.bypass = false;
        let scale = self.settings.gain_scale;
        for band in &mut self.config.bands {
            band.frequency_hz = band.frequency_hz.min(self.sample_rate * 0.498);
            band.gain_db = (band.gain_db * scale).clamp(-36.0, 36.0);
        }
        self.semantic_valid = self.config.validate(self.sample_rate).is_ok();
    }

    pub fn latency_samples(&self) -> u32 {
        self.active
            .as_ref()
            .map_or(0, |active| active.latency_samples() as u32)
    }

    fn synchronize(&mut self, params: &EqParams) {
        let previous_settings = self.settings;
        if !self.read_parameters(params) {
            return;
        }
        self.prepare_config();
        if !self.semantic_valid {
            self.settings = previous_settings;
        }
        if let Some(worker) = &self.worker {
            let requires_preparation = !self.semantic_valid
                || self.active.as_mut().is_none_or(|active| {
                    active.processor.processing_mode() != self.config.processing_mode
                        || active.processor.update_rt(&self.config).is_err()
                });
            let changed = self.requested.bands != self.config.bands
                || self.config.processing_mode != self.requested.processing_mode
                || self.config.linear_phase_resolution != self.requested.linear_phase_resolution
                || worker.lane.generation() == 0 && requires_preparation;
            if changed {
                if !requires_preparation && let Some(active) = &self.active {
                    params
                        .telemetry
                        .publish_active_config_rt(active.processor.active_config());
                }
                self.requested.bands.clear();
                self.requested.bands.extend_from_slice(&self.config.bands);
                self.requested.output_gain_db = self.config.output_gain_db;
                self.requested.bypass = self.config.bypass;
                self.requested.processing_mode = self.config.processing_mode;
                self.requested.linear_phase_resolution = self.config.linear_phase_resolution;
                worker.lane.request(&self.requested, requires_preparation);
            }
            if self
                .staged
                .as_ref()
                .is_some_and(|staged| staged.generation != worker.lane.generation())
            {
                worker.lane.retire_staged(&mut self.staged);
            }
            if self.staged.is_none() && worker.lane.adopt(&mut self.staged) {
                self.warmup = self
                    .staged
                    .as_ref()
                    .map_or(0, |staged| staged.warmup_samples());
                self.fade = 0;
            }
            params.telemetry.publish_processing(
                (requires_preparation
                    || self.staged.is_some()
                    || self
                        .active
                        .as_ref()
                        .is_some_and(|active| active.processor.has_pending_band_update()))
                    && worker.lane.error() == 0,
                worker.lane.error(),
            );
        }
        self.solo.configure(
            self.active.as_ref().and_then(|active| {
                params.telemetry.solo().and_then(|id| {
                    active
                        .processor
                        .active_config()
                        .bands
                        .iter()
                        .find(|band| band.id == id)
                })
            }),
            self.sample_rate,
        );
    }

    pub fn process(&mut self, params: &EqParams, buffer: &mut AudioBuffer, events: &EventList) {
        self.synchronize(params);
        let initial_band_revision = self
            .active
            .as_ref()
            .map_or(0, |active| active.processor.band_revision());
        let mut input_peak = [0.0f32; 2];
        let mut output_peak = [0.0f32; 2];
        let output_channels = buffer.num_output_channels();
        params.telemetry.publish_output_layout_rt(output_channels);
        let input_channels = buffer.num_input_channels();
        if output_channels < 2 {
            self.pan = crate::output_pan::OutputPan::new(
                self.sample_rate,
                0.0,
                self.settings.pan_mode,
                false,
            );
        }
        self.pan.set_target(
            self.settings.pan,
            self.settings.pan_mode,
            output_channels > 1,
        );
        let main_channels = if input_channels == 3 {
            1
        } else {
            input_channels.min(output_channels).min(2)
        };
        let energy_coefficient = (-1.0 / (self.sample_rate * 0.5)).exp();
        let gain_coefficient = (1.0 - (-1.0 / (self.sample_rate * 0.005)).exp()) as f32;
        let mut next_event = 0;
        for index in 0..buffer.num_samples() {
            let mut changed = false;
            while let Some(event) = events.get(next_event) {
                if event.sample_offset as usize > index {
                    break;
                }
                match event.body {
                    EventBody::ControlChange { cc, value, .. } => {
                        crate::midi::process_cc(params, cc, f64::from(value) / 127.0);
                        changed = true;
                    }
                    EventBody::ControlChange2 { cc, value, .. } => {
                        crate::midi::process_cc(params, cc, f64::from(value) / f64::from(u32::MAX));
                        changed = true;
                    }
                    _ => {}
                }
                next_event += 1;
            }
            if changed {
                self.synchronize(params);
                self.pan.set_target(
                    self.settings.pan,
                    self.settings.pan_mode,
                    output_channels > 1,
                );
            }
            let target_gain = self.settings.gain;
            let left = if main_channels > 0 {
                finite_sample(buffer.input(0)[index])
            } else {
                0.0
            };
            let right = if main_channels > 1 {
                finite_sample(buffer.input(1)[index])
            } else {
                left
            };
            let external = if input_channels > main_channels && input_channels - main_channels >= 2
            {
                [
                    finite_sample(buffer.input(main_channels)[index]),
                    finite_sample(buffer.input(main_channels + 1)[index]),
                ]
            } else {
                [0.0; 2]
            };
            let mut signal = self.render([left, right], &params.telemetry);
            self.input_energy = energy_coefficient * self.input_energy
                + (1.0 - energy_coefficient) * f64::from((left * left + right * right) * 0.5);
            self.output_energy = energy_coefficient * self.output_energy
                + (1.0 - energy_coefficient)
                    * f64::from((signal[0] * signal[0] + signal[1] * signal[1]) * 0.5);
            let correction = if self.settings.auto_gain
                && self.input_energy > 1.0e-10
                && self.output_energy > 1.0e-10
            {
                (self.input_energy / self.output_energy)
                    .sqrt()
                    .clamp(0.2511886432, 3.981071706) as f32
            } else {
                1.0
            };
            self.auto_gain += (correction - self.auto_gain) * gain_coefficient;
            self.gain += (target_gain - self.gain) * gain_coefficient;
            let polarity = if self.settings.phase_invert {
                -1.0
            } else {
                1.0
            };
            for value in &mut signal {
                *value *= self.gain * self.auto_gain * polarity;
            }
            let history_size = self.dry_history.len();
            self.dry_history[self.dry_cursor] = [left, right];
            self.solo_history[self.dry_cursor] = if self.solo.active {
                self.solo.process([left, right])
            } else {
                [left, right]
            };
            let delayed =
                (self.dry_cursor + history_size - self.latency_samples() as usize) % history_size;
            if self.solo.active {
                signal = self.solo_history[delayed];
            }
            signal = self.pan.process(signal);
            let mute_target = if self.settings.mute { 0.0 } else { 1.0 };
            self.mute_gain += (mute_target - self.mute_gain) * gain_coefficient;
            if (mute_target - self.mute_gain).abs() < 1.0e-7 {
                self.mute_gain = mute_target;
            }
            for sample in &mut signal {
                *sample *= self.mute_gain;
            }
            let target_wet = if self.settings.bypass { 0.0 } else { 1.0 };
            self.wet += (target_wet - self.wet) * gain_coefficient;
            if (target_wet - self.wet).abs() < 1.0e-6 {
                self.wet = target_wet;
            }
            for (channel, value) in signal.iter_mut().enumerate() {
                *value = finite_sample(
                    *value * self.wet + self.dry_history[delayed][channel] * (1.0 - self.wet),
                );
            }
            self.dry_cursor = (self.dry_cursor + 1) % history_size;
            for channel in 0..2 {
                input_peak[channel] = input_peak[channel].max([left, right][channel].abs());
                output_peak[channel] = output_peak[channel].max(signal[channel].abs());
            }
            params.telemetry.capture([left, right], signal, external);
            if output_channels > 0 {
                buffer.output(0)[index] = signal[0];
            }
            if output_channels > 1 {
                buffer.output(1)[index] = signal[1];
            }
        }
        if let Some(active) = &self.active
            && active.processor.band_revision() != initial_band_revision
        {
            // A queued IIR target can be promoted within this block without a
            // new host parameter notification. Publish its installed target.
            params
                .telemetry
                .publish_active_config_rt(active.processor.active_config());
            if let Some(worker) = &self.worker {
                let installed = active.processor.active_config();
                let pending = self.staged.is_some()
                    || active.processor.has_pending_band_update()
                    || installed.bands != self.config.bands
                    || installed.processing_mode != self.config.processing_mode
                    || installed.linear_phase_resolution != self.config.linear_phase_resolution;
                params
                    .telemetry
                    .publish_processing(pending && worker.lane.error() == 0, worker.lane.error());
            }
        }
        params.telemetry.publish_levels(
            input_peak,
            output_peak,
            20.0 * self.auto_gain.max(1.0e-6).log10(),
            20.0 * (self.gain * self.mute_gain).max(1.0e-6).log10(),
            self.wet == 0.0,
            self.wet == 0.0 || self.mute_gain > 0.0 && !self.solo.active,
        );
        params.telemetry.publish_output_pan_rt(self.pan.matrix());
        params
            .telemetry
            .publish_output_muted_rt(self.mute_gain == 0.0 && self.wet == 1.0);
    }

    fn render(&mut self, input: [f32; 2], telemetry: &crate::telemetry::EqTelemetry) -> [f32; 2] {
        let current = self
            .active
            .as_mut()
            .map_or(input, |active| active.process(input));
        let mut output = current;
        if self.staged.as_ref().is_some_and(|staged| {
            self.worker
                .as_ref()
                .is_some_and(|worker| worker.lane.generation() != staged.generation)
        }) {
            return current;
        }
        if let Some(staged) = &mut self.staged {
            let next = staged.process(input);
            if self.warmup > 0 {
                self.warmup -= 1;
            } else {
                // Equal-latency FIR edits are naturally aligned. Mode changes
                // crossfade each warmed path at its own latency, avoiding an
                // abrupt delay-line jump; host PDC changes at owner handoff.
                let fade_samples = (self.sample_rate * 0.01).ceil() as usize;
                let blend = (self.fade as f32 / fade_samples as f32).min(1.0);
                output = std::array::from_fn(|channel| {
                    current[channel] * (1.0 - blend) + next[channel] * blend
                });
                self.fade = self.fade.saturating_add(1);
                if self.fade >= fade_samples
                    && let Some(worker) = &self.worker
                    && worker
                        .lane
                        .finish_transition(&mut self.active, &mut self.staged)
                    && let Some(active) = &self.active
                {
                    telemetry.publish_active_response_rt(&active.response);
                    telemetry.publish_active_config_rt(active.processor.active_config());
                }
            }
        }
        output
    }
}

pub(crate) fn finite_sample(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(-1.0e12, 1.0e12)
    } else {
        0.0
    }
}

#[derive(Default)]
struct SoloFilter {
    active: bool,
    signature: Option<(u32, f64, f64)>,
    coefficients: [f64; 5],
    state: [[f64; 2]; 2],
}

impl SoloFilter {
    fn configure(&mut self, band: Option<&EqBand>, sample_rate: f64) {
        self.active = band.is_some();
        let signature = band.map(|band| (band.id, band.frequency_hz, band.q));
        if signature == self.signature {
            return;
        }
        self.signature = signature;
        self.state.fill([0.0; 2]);
        if let Some(band) = band {
            let angle = std::f64::consts::TAU * band.frequency_hz / sample_rate;
            let alpha = angle.sin() / (2.0 * band.q);
            let inverse = 1.0 / (1.0 + alpha);
            self.coefficients = [
                alpha * inverse,
                0.0,
                -alpha * inverse,
                -2.0 * angle.cos() * inverse,
                (1.0 - alpha) * inverse,
            ];
        }
    }

    fn process(&mut self, input: [f32; 2]) -> [f32; 2] {
        let [b0, b1, b2, a1, a2] = self.coefficients;
        std::array::from_fn(|channel| {
            let value = f64::from(input[channel]);
            let output = b0 * value + self.state[channel][0];
            self.state[channel][0] = b1 * value - a1 * output + self.state[channel][1];
            self.state[channel][1] = b2 * value - a2 * output;
            output as f32
        })
    }
}
