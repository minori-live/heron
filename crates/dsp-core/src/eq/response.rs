use super::{
    BRICKWALL_SLOPE, EqBand, EqChannel, EqConfig, EqShape, ProcessingMode, coefficients::design,
};
use rustfft::num_complex::Complex64;
use std::f64::consts::PI;

/// A complex transfer; phase and magnitude use the same native model.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EqResponse {
    pub re: f64,
    pub im: f64,
}
impl EqResponse {
    pub fn magnitude_db(self) -> f64 {
        20.0 * self.re.hypot(self.im).max(1.0e-15).log10()
    }
    pub fn phase_radians(self) -> f64 {
        self.im.atan2(self.re)
    }
}
impl From<Complex64> for EqResponse {
    fn from(value: Complex64) -> Self {
        Self {
            re: value.re,
            im: value.im,
        }
    }
}

/// Full 2x2 stereo transfer, including crossfeed introduced by Mid/Side bands.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EqResponseMatrix {
    pub left_to_left: EqResponse,
    pub right_to_left: EqResponse,
    pub left_to_right: EqResponse,
    pub right_to_right: EqResponse,
}

impl EqResponseMatrix {
    pub const fn identity() -> Self {
        let one = EqResponse { re: 1.0, im: 0.0 };
        let zero = EqResponse { re: 0.0, im: 0.0 };
        Self {
            left_to_left: one,
            right_to_left: zero,
            left_to_right: zero,
            right_to_right: one,
        }
    }

    /// Same input/output channel projection used by the audio processor.
    pub fn projected_response(self, channel: EqChannel) -> EqResponse {
        let a = Complex64::new(self.left_to_left.re, self.left_to_left.im);
        let b = Complex64::new(self.right_to_left.re, self.right_to_left.im);
        let c = Complex64::new(self.left_to_right.re, self.left_to_right.im);
        let d = Complex64::new(self.right_to_right.re, self.right_to_right.im);
        match channel {
            EqChannel::Stereo => (a + d) / 2.0,
            EqChannel::Left => a,
            EqChannel::Right => d,
            EqChannel::Mid => (a + b + c + d) / 2.0,
            EqChannel::Side => (a - b - c + d) / 2.0,
        }
        .into()
    }
    pub fn magnitude_db(self, channel: EqChannel) -> f64 {
        self.projected_response(channel).magnitude_db()
    }
}

pub(super) type Matrix = [[Complex64; 2]; 2];
pub(super) fn identity() -> Matrix {
    [
        [Complex64::new(1.0, 0.0), Complex64::new(0.0, 0.0)],
        [Complex64::new(0.0, 0.0), Complex64::new(1.0, 0.0)],
    ]
}

pub(super) fn band_matrix(channel: EqChannel, h: Complex64) -> Matrix {
    let one = Complex64::new(1.0, 0.0);
    let zero = Complex64::new(0.0, 0.0);
    match channel {
        EqChannel::Stereo => [[h, zero], [zero, h]],
        EqChannel::Left => [[h, zero], [zero, one]],
        EqChannel::Right => [[one, zero], [zero, h]],
        EqChannel::Mid => [
            [(h + one) / 2.0, (h - one) / 2.0],
            [(h - one) / 2.0, (h + one) / 2.0],
        ],
        EqChannel::Side => [
            [(h + one) / 2.0, (one - h) / 2.0],
            [(one - h) / 2.0, (h + one) / 2.0],
        ],
    }
}

fn multiply(left: Matrix, right: Matrix) -> Matrix {
    std::array::from_fn(|row| {
        std::array::from_fn(|column| {
            left[row][0] * right[0][column] + left[row][1] * right[1][column]
        })
    })
}

pub(super) fn raw_matrix(
    config: &EqConfig,
    sample_rate: f64,
    omega: f64,
    magnitude_only: bool,
) -> Matrix {
    let mut response = identity();
    for band in &config.bands {
        let h = band_transfer(band, sample_rate, omega);
        let h = if magnitude_only {
            Complex64::new(h.norm(), 0.0)
        } else {
            h
        };
        response = multiply(band_matrix(band.channel, h), response);
    }
    let gain = 10.0_f64.powf(config.output_gain_db / 20.0);
    response.map(|row| row.map(|entry| entry * gain))
}

impl EqBand {
    /// Static band response shared by the visualizer and fitter.
    pub fn response(&self, sample_rate: f64, frequency_hz: f64) -> EqResponse {
        band_transfer(self, sample_rate, 2.0 * PI * frequency_hz / sample_rate).into()
    }
    pub fn magnitude_db(&self, sample_rate: f64, frequency_hz: f64) -> f64 {
        self.response(sample_rate, frequency_hz).magnitude_db()
    }
}

impl EqConfig {
    /// The exact static IIR transfer, or the ideal target for FIR preparation.
    /// For the actual finite linear-phase response use EqProcessor::response_matrix.
    pub fn response_matrix(&self, sample_rate: f64, frequency_hz: f64) -> EqResponseMatrix {
        let omega = 2.0 * PI * frequency_hz / sample_rate;
        let matrix = if self.bypass {
            let delay = match self.processing_mode {
                ProcessingMode::ZeroLatency => 0,
                ProcessingMode::NaturalPhase => 16,
                ProcessingMode::LinearPhase => self.linear_phase_resolution.latency_samples(),
            };
            identity().map(|row| {
                row.map(|entry| entry * Complex64::from_polar(1.0, -omega * delay as f64))
            })
        } else {
            match self.processing_mode {
                ProcessingMode::ZeroLatency => raw_matrix(self, sample_rate, omega, false),
                ProcessingMode::NaturalPhase => {
                    let filters = oversampling_kernel();
                    let low_omega = omega / 2.0;
                    let image_omega = low_omega + PI;
                    let low = fir_response(&filters, low_omega).powu(2);
                    let image = fir_response(&filters, image_omega).powu(2);
                    let base = raw_matrix(self, sample_rate * 2.0, low_omega, false);
                    let alias = raw_matrix(self, sample_rate * 2.0, image_omega, false);
                    let gain = 10.0_f64.powf(self.output_gain_db / 20.0);
                    let delay = Complex64::from_polar(gain, -omega * 16.0);
                    let transparent = identity();
                    std::array::from_fn(|row| {
                        std::array::from_fn(|column| {
                            transparent[row][column] * delay
                                + (base[row][column] - transparent[row][column] * gain) * low
                                + (alias[row][column] - transparent[row][column] * gain) * image
                        })
                    })
                }
                ProcessingMode::LinearPhase => {
                    let matrix = raw_matrix(self, sample_rate, omega, true);
                    let phase = Complex64::from_polar(
                        1.0,
                        -omega * self.linear_phase_resolution.latency_samples() as f64,
                    );
                    matrix.map(|row| row.map(|entry| entry * phase))
                }
            }
        };
        EqResponseMatrix {
            left_to_left: matrix[0][0].into(),
            right_to_left: matrix[0][1].into(),
            left_to_right: matrix[1][0].into(),
            right_to_right: matrix[1][1].into(),
        }
    }

    /// Projection of the stereo matrix onto the requested input/output channel.
    /// `Stereo` shows the mean of the two diagonal responses.
    pub fn magnitude_db(&self, sample_rate: f64, frequency_hz: f64, channel: EqChannel) -> f64 {
        self.response_matrix(sample_rate, frequency_hz)
            .magnitude_db(channel)
    }
}

pub(super) const OVERSAMPLE_TAPS: usize = 33;
pub(super) fn oversampling_kernel() -> [f64; OVERSAMPLE_TAPS] {
    let mut kernel = std::array::from_fn(|index| {
        let position = index as f64 - 16.0;
        let sinc = if position == 0.0 {
            0.5
        } else {
            (PI * position / 2.0).sin() / (PI * position)
        };
        // Blackman window: stopband rejection is part of the actual response.
        let phase = 2.0 * PI * index as f64 / 32.0;
        sinc * (0.42 - 0.5 * phase.cos() + 0.08 * (2.0 * phase).cos())
    });
    let sum: f64 = kernel.iter().sum();
    for coefficient in &mut kernel {
        *coefficient /= sum;
    }
    kernel
}

fn fir_response(kernel: &[f64], omega: f64) -> Complex64 {
    kernel
        .iter()
        .enumerate()
        .map(|(index, value)| Complex64::from_polar(*value, -omega * index as f64))
        .sum()
}

fn band_transfer(band: &EqBand, sample_rate: f64, omega: f64) -> Complex64 {
    if !band.enabled || band.slope_db_oct == 0.0 {
        return Complex64::new(1.0, 0.0);
    }
    if band.slope_db_oct == BRICKWALL_SLOPE {
        let frequency = omega.abs() * sample_rate / (2.0 * PI);
        let pass = match band.shape {
            EqShape::LowCut => frequency >= band.frequency_hz,
            EqShape::HighCut => frequency <= band.frequency_hz,
            EqShape::BandPass => {
                let spread = (4.0 * band.q * band.q + 1.0).sqrt();
                let low = band.frequency_hz * (spread - 1.0) / (2.0 * band.q);
                let high = band.frequency_hz * (spread + 1.0) / (2.0 * band.q);
                frequency >= low && frequency <= high
            }
            _ => true,
        };
        return Complex64::new(if pass { 1.0 } else { 0.0 }, 0.0);
    }
    design(band, sample_rate).response(omega)
}
