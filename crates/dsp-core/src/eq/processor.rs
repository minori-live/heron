use super::{
    EqBand, EqChannel, EqConfig, EqError, EqResponseMatrix, MAX_EQ_BANDS, ProcessingMode,
    coefficients::{BandDesign, FilterState, MAX_SECTIONS, design},
    convolution::LinearConvolver,
    response::{OVERSAMPLE_TAPS, oversampling_kernel},
};

#[derive(Clone, Copy)]
struct BandProcessor {
    config: EqBand,
    design: BandDesign,
    low_state: [[FilterState; MAX_SECTIONS]; 2],
    high_state: [[FilterState; MAX_SECTIONS]; 2],
}

impl BandProcessor {
    fn empty() -> Self {
        Self::prepare(
            EqBand {
                enabled: false,
                ..EqBand::default()
            },
            48000.0,
        )
    }
    fn prepare(config: EqBand, sample_rate: f64) -> Self {
        Self {
            config,
            design: design(&config, sample_rate),
            low_state: [[FilterState::default(); MAX_SECTIONS]; 2],
            high_state: [[FilterState::default(); MAX_SECTIONS]; 2],
        }
    }

    fn process(&mut self, left: f64, right: f64) -> (f64, f64) {
        if !self.config.enabled {
            return (left, right);
        }
        match self.config.channel {
            EqChannel::Stereo => (self.filter(left, 0), self.filter(right, 1)),
            EqChannel::Left => (self.filter(left, 0), right),
            EqChannel::Right => (left, self.filter(right, 1)),
            EqChannel::Mid => {
                let mid = self.filter((left + right) * 0.5, 0);
                let side = (left - right) * 0.5;
                (mid + side, mid - side)
            }
            EqChannel::Side => {
                let mid = (left + right) * 0.5;
                let side = self.filter((left - right) * 0.5, 0);
                (mid + side, mid - side)
            }
        }
    }

    fn filter(&mut self, input: f64, channel: usize) -> f64 {
        let mut low = input;
        for index in 0..self.design.low_count {
            low = self.low_state[channel][index].process(self.design.low[index], low);
        }
        if self.design.mix == 0.0 {
            return low * self.design.scale;
        }
        let mut high = input;
        for index in 0..self.design.high_count {
            high = self.high_state[channel][index].process(self.design.high[index], high);
        }
        (low * (1.0 - self.design.mix) + high * self.design.mix) * self.design.scale
    }
}

#[derive(Clone, Copy)]
struct OversamplingFir {
    kernel: [f64; OVERSAMPLE_TAPS],
    history: [[f64; OVERSAMPLE_TAPS]; 2],
    cursor: usize,
}
impl OversamplingFir {
    fn new() -> Self {
        Self {
            kernel: oversampling_kernel(),
            history: [[0.0; OVERSAMPLE_TAPS]; 2],
            cursor: 0,
        }
    }
    fn process(&mut self, input: (f64, f64)) -> (f64, f64) {
        self.history[0][self.cursor] = input.0;
        self.history[1][self.cursor] = input.1;
        let mut result = [0.0; 2];
        for (channel, value) in result.iter_mut().enumerate() {
            for index in 0..OVERSAMPLE_TAPS {
                *value += self.kernel[index]
                    * self.history[channel]
                        [(self.cursor + OVERSAMPLE_TAPS - index) % OVERSAMPLE_TAPS];
            }
        }
        self.cursor = (self.cursor + 1) % OVERSAMPLE_TAPS;
        (result[0], result[1])
    }
}

/// Prepared stereo EQ. Construction and destruction belong on a control thread.
/// Every processing method, including coefficient transitions, is allocation-free.
pub struct EqProcessor {
    config: EqConfig,
    sample_rate: f64,
    bands: Box<[BandProcessor; MAX_EQ_BANDS]>,
    previous_bands: Box<[BandProcessor; MAX_EQ_BANDS]>,
    pending_bands: Vec<EqBand>,
    pending_band_update: bool,
    band_revision: u64,
    transition_remaining: usize,
    transition_samples: usize,
    gain: f64,
    prepared_gain: f64,
    target_gain: f64,
    wet: f64,
    target_wet: f64,
    smoothing: f64,
    upsample: OversamplingFir,
    downsample: OversamplingFir,
    convolution: Option<LinearConvolver>,
    dry_delay: Vec<(f64, f64)>,
    dry_cursor: usize,
}

impl EqProcessor {
    /// Prepare validated state, FFT kernels and all real-time storage.
    pub fn prepare(config: &EqConfig, sample_rate: f64) -> Result<Self, EqError> {
        config.validate(sample_rate)?;
        let internal_rate = if config.processing_mode == ProcessingMode::NaturalPhase {
            sample_rate * 2.0
        } else {
            sample_rate
        };
        let bands = Box::new(std::array::from_fn(|index| {
            config
                .bands
                .get(index)
                .copied()
                .map(|band| BandProcessor::prepare(band, internal_rate))
                .unwrap_or_else(BandProcessor::empty)
        }));
        let gain = 10.0_f64.powf(config.output_gain_db / 20.0);
        let wet = if config.bypass { 0.0 } else { 1.0 };
        let latency = match config.processing_mode {
            ProcessingMode::ZeroLatency => 0,
            ProcessingMode::NaturalPhase => 16,
            ProcessingMode::LinearPhase => config.linear_phase_resolution.latency_samples(),
        };
        let mut state = config.clone();
        state.bands.reserve(MAX_EQ_BANDS - state.bands.len());
        Ok(Self {
            previous_bands: bands.clone(),
            bands,
            config: state,
            pending_bands: Vec::with_capacity(MAX_EQ_BANDS),
            pending_band_update: false,
            band_revision: 0,
            sample_rate,
            transition_remaining: 0,
            transition_samples: (internal_rate * 0.005).ceil() as usize,
            gain,
            prepared_gain: gain,
            target_gain: gain,
            wet,
            target_wet: wet,
            smoothing: 1.0 - (-1.0 / (sample_rate * 0.005)).exp(),
            upsample: OversamplingFir::new(),
            downsample: OversamplingFir::new(),
            convolution: if config.processing_mode == ProcessingMode::LinearPhase {
                Some(LinearConvolver::prepare(config, sample_rate))
            } else {
                None
            },
            dry_delay: vec![(0.0, 0.0); latency],
            dry_cursor: 0,
        })
    }

    /// Update IIR parameters without allocating. Linear-phase kernels or mode
    /// changes require preparation and publication from the control thread.
    /// Failed validation leaves the current processor unchanged.
    /// Edits during an IIR crossfade coalesce into one latest target, installed
    /// after the running fade completes. They never discard an audible branch.
    pub fn update_rt(&mut self, config: &EqConfig) -> Result<(), EqError> {
        config.validate(self.sample_rate)?;
        if config.processing_mode != self.config.processing_mode
            || config.linear_phase_resolution != self.config.linear_phase_resolution
        {
            return Err(EqError::RequiresPreparation);
        }
        if self.config.processing_mode == ProcessingMode::LinearPhase
            && config.bands != self.config.bands
        {
            return Err(EqError::RequiresPreparation);
        }
        if config.bands == self.config.bands {
            // Returning to the installed target also cancels a queued edit.
            self.pending_bands.clear();
            self.pending_band_update = false;
        } else if self.transition_remaining > 0 {
            self.pending_bands.clear();
            self.pending_bands.extend_from_slice(&config.bands);
            self.pending_band_update = true;
        } else {
            self.config.bands.clear();
            self.config.bands.extend_from_slice(&config.bands);
            self.start_band_transition();
        }
        self.target_gain = 10.0_f64.powf(config.output_gain_db / 20.0);
        self.target_wet = if config.bypass { 0.0 } else { 1.0 };
        self.config.output_gain_db = config.output_gain_db;
        self.config.bypass = config.bypass;
        Ok(())
    }

    pub fn latency_samples(&self) -> usize {
        self.dry_delay.len()
    }
    pub fn processing_mode(&self) -> ProcessingMode {
        self.config.processing_mode
    }

    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    /// Installed target parameters. A queued band edit is excluded until its
    /// crossfade begins. This borrow never allocates or locks.
    pub fn active_config(&self) -> &EqConfig {
        &self.config
    }

    /// Whether a newer band target is waiting for the current IIR fade to finish.
    pub fn has_pending_band_update(&self) -> bool {
        self.pending_band_update
    }

    /// Changes only when a band target is installed, including queued promotion.
    /// Enables bounded metadata publication without copying config every sample.
    pub fn band_revision(&self) -> u64 {
        self.band_revision
    }

    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        let input = (finite_input(left), finite_input(right));
        let dry = self.delayed_dry(input);
        let mut output = match self.config.processing_mode {
            ProcessingMode::ZeroLatency => self.process_bands(input),
            ProcessingMode::NaturalPhase => {
                let up = self.upsample.process((input.0 * 2.0, input.1 * 2.0));
                let first = self.process_bands(up);
                let result = self.downsample.process((first.0 - up.0, first.1 - up.1));
                let up = self.upsample.process((0.0, 0.0));
                let second = self.process_bands(up);
                self.downsample.process((second.0 - up.0, second.1 - up.1));
                (dry.0 + result.0, dry.1 + result.1)
            }
            ProcessingMode::LinearPhase => self
                .convolution
                .as_mut()
                .map_or(input, |convolver| convolver.process(input.0, input.1)),
        };
        self.gain += (self.target_gain - self.gain) * self.smoothing;
        self.wet += (self.target_wet - self.wet) * self.smoothing;
        // Linear kernels contain the prepared gain; changes are a smooth ratio.
        let gain = if self.config.processing_mode == ProcessingMode::LinearPhase {
            self.gain / self.linear_prepared_gain()
        } else {
            self.gain
        };
        output.0 = dry.0 + (output.0 * gain - dry.0) * self.wet;
        output.1 = dry.1 + (output.1 * gain - dry.1) * self.wet;
        (finite_output(output.0), finite_output(output.1))
    }

    /// Measured-display transfer for the actual prepared FIR, including its
    /// finite length/window and partition delay; IIR modes share config math.
    pub fn response_matrix(&self, frequency_hz: f64) -> EqResponseMatrix {
        self.convolution
            .as_ref()
            .filter(|_| !self.config.bypass)
            .map_or_else(
                || self.config.response_matrix(self.sample_rate, frequency_hz),
                |convolver| {
                    let mut response = convolver.response_matrix(self.sample_rate, frequency_hz);
                    let scale = self.target_gain / self.prepared_gain;
                    for value in [
                        &mut response.left_to_left,
                        &mut response.right_to_left,
                        &mut response.left_to_right,
                        &mut response.right_to_right,
                    ] {
                        value.re *= scale;
                        value.im *= scale;
                    }
                    response
                },
            )
    }

    fn linear_prepared_gain(&self) -> f64 {
        self.prepared_gain
    }
    fn internal_rate(&self) -> f64 {
        if self.config.processing_mode == ProcessingMode::NaturalPhase {
            self.sample_rate * 2.0
        } else {
            self.sample_rate
        }
    }
    fn delayed_dry(&mut self, input: (f64, f64)) -> (f64, f64) {
        if self.dry_delay.is_empty() {
            return input;
        }
        let previous = self.dry_delay[self.dry_cursor];
        self.dry_delay[self.dry_cursor] = input;
        self.dry_cursor = (self.dry_cursor + 1) % self.dry_delay.len();
        previous
    }
    fn process_bands(&mut self, input: (f64, f64)) -> (f64, f64) {
        let mut result = input;
        for band in self.bands.iter_mut() {
            result = band.process(result.0, result.1);
        }
        if self.transition_remaining > 0 {
            let mut previous = input;
            for band in self.previous_bands.iter_mut() {
                previous = band.process(previous.0, previous.1);
            }
            let mix = 1.0 - self.transition_remaining as f64 / self.transition_samples as f64;
            result = (
                previous.0 + (result.0 - previous.0) * mix,
                previous.1 + (result.1 - previous.1) * mix,
            );
            self.transition_remaining -= 1;
            if self.transition_remaining == 0 && self.pending_band_update {
                std::mem::swap(&mut self.config.bands, &mut self.pending_bands);
                self.pending_bands.clear();
                self.pending_band_update = false;
                self.start_band_transition();
            }
        }
        result
    }

    fn start_band_transition(&mut self) {
        *self.previous_bands = *self.bands;
        let internal_rate = self.internal_rate();
        for index in 0..MAX_EQ_BANDS {
            self.bands[index] = if let Some(band) = self.config.bands.get(index) {
                let mut prepared = BandProcessor::prepare(*band, internal_rate);
                if let Some(previous) = self
                    .previous_bands
                    .iter()
                    .find(|previous| previous.config.id == band.id && previous.config.enabled)
                    && previous.config.shape == band.shape
                    && previous.config.channel == band.channel
                {
                    prepared.low_state = previous.low_state;
                    prepared.high_state = previous.high_state;
                }
                prepared
            } else {
                BandProcessor::empty()
            };
        }
        self.transition_remaining = self.transition_samples;
        self.band_revision = self.band_revision.wrapping_add(1);
    }
}

fn finite_input(value: f32) -> f64 {
    if value.is_finite() {
        f64::from(value)
    } else {
        0.0
    }
}
fn finite_output(value: f64) -> f32 {
    if value.is_finite() {
        value.clamp(-f64::from(f32::MAX), f64::from(f32::MAX)) as f32
    } else {
        0.0
    }
}
