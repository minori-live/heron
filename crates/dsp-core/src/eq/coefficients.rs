use super::{EqBand, EqShape};
use rustfft::num_complex::Complex64;
use std::f64::consts::{FRAC_1_SQRT_2, PI};

pub(super) const MAX_SECTIONS: usize = 32;

#[derive(Debug, Clone, Copy)]
pub(super) struct Biquad {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

impl Biquad {
    pub const IDENTITY: Self = Self {
        b0: 1.0,
        b1: 0.0,
        b2: 0.0,
        a1: 0.0,
        a2: 0.0,
    };
    fn normalized(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
    pub fn response(self, omega: f64) -> Complex64 {
        let z = Complex64::from_polar(1.0, -omega);
        (self.b0 + self.b1 * z + self.b2 * z * z) / (1.0 + self.a1 * z + self.a2 * z * z)
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct FilterState {
    z1: f64,
    z2: f64,
}
impl FilterState {
    pub fn process(&mut self, coefficient: Biquad, input: f64) -> f64 {
        let output = coefficient.b0 * input + self.z1;
        self.z1 = coefficient.b1 * input - coefficient.a1 * output + self.z2;
        self.z2 = coefficient.b2 * input - coefficient.a2 * output;
        // Flush very small recursive state, including a silent long-tail decay.
        if self.z1.abs() < 1.0e-30 {
            self.z1 = 0.0;
        }
        if self.z2.abs() < 1.0e-30 {
            self.z2 = 0.0;
        }
        output
    }
}

/// RBJ Q, shared exactly with the fitter: alpha=sin(omega)/(2Q).
pub(super) fn rbj(shape: EqShape, frequency: f64, gain: f64, q: f64, sample_rate: f64) -> Biquad {
    let omega = 2.0 * PI * frequency / sample_rate;
    let cosine = omega.cos();
    let alpha = omega.sin() / (2.0 * q);
    let a = 10.0_f64.powf(gain / 40.0);
    let beta = 2.0 * a.sqrt() * alpha;
    let plus = a + 1.0;
    let minus = a - 1.0;
    match shape {
        EqShape::Bell => Biquad::normalized(
            1.0 + alpha * a,
            -2.0 * cosine,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * cosine,
            1.0 - alpha / a,
        ),
        EqShape::LowShelf => Biquad::normalized(
            a * (plus - minus * cosine + beta),
            2.0 * a * (minus - plus * cosine),
            a * (plus - minus * cosine - beta),
            plus + minus * cosine + beta,
            -2.0 * (minus + plus * cosine),
            plus + minus * cosine - beta,
        ),
        EqShape::HighShelf => Biquad::normalized(
            a * (plus + minus * cosine + beta),
            -2.0 * a * (minus + plus * cosine),
            a * (plus + minus * cosine - beta),
            plus - minus * cosine + beta,
            2.0 * (minus - plus * cosine),
            plus - minus * cosine - beta,
        ),
        EqShape::LowCut => Biquad::normalized(
            (1.0 + cosine) / 2.0,
            -(1.0 + cosine),
            (1.0 + cosine) / 2.0,
            1.0 + alpha,
            -2.0 * cosine,
            1.0 - alpha,
        ),
        EqShape::HighCut => Biquad::normalized(
            (1.0 - cosine) / 2.0,
            1.0 - cosine,
            (1.0 - cosine) / 2.0,
            1.0 + alpha,
            -2.0 * cosine,
            1.0 - alpha,
        ),
        EqShape::Notch => Biquad::normalized(
            1.0,
            -2.0 * cosine,
            1.0,
            1.0 + alpha,
            -2.0 * cosine,
            1.0 - alpha,
        ),
        EqShape::BandPass => {
            Biquad::normalized(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cosine, 1.0 - alpha)
        }
        EqShape::AllPass => Biquad::normalized(
            1.0 - alpha,
            -2.0 * cosine,
            1.0 + alpha,
            1.0 + alpha,
            -2.0 * cosine,
            1.0 - alpha,
        ),
        EqShape::TiltShelf | EqShape::FlatTilt => Biquad::IDENTITY,
    }
}

fn first_order_cut(shape: EqShape, frequency: f64, sample_rate: f64) -> Biquad {
    let k = (PI * frequency / sample_rate).tan();
    let denominator = 1.0 + k;
    match shape {
        EqShape::LowCut => Biquad {
            b0: 1.0 / denominator,
            b1: -1.0 / denominator,
            b2: 0.0,
            a1: (k - 1.0) / denominator,
            a2: 0.0,
        },
        _ => Biquad {
            b0: k / denominator,
            b1: k / denominator,
            b2: 0.0,
            a1: (k - 1.0) / denominator,
            a2: 0.0,
        },
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct BandDesign {
    pub low: [Biquad; MAX_SECTIONS],
    pub high: [Biquad; MAX_SECTIONS],
    pub low_count: usize,
    pub high_count: usize,
    pub mix: f64,
    pub scale: f64,
}
impl BandDesign {
    pub const IDENTITY: Self = Self {
        low: [Biquad::IDENTITY; MAX_SECTIONS],
        high: [Biquad::IDENTITY; MAX_SECTIONS],
        low_count: 0,
        high_count: 0,
        mix: 0.0,
        scale: 1.0,
    };
    pub fn response(&self, omega: f64) -> Complex64 {
        let low: Complex64 = self.low[..self.low_count]
            .iter()
            .map(|coefficient| coefficient.response(omega))
            .product();
        let high: Complex64 = self.high[..self.high_count]
            .iter()
            .map(|coefficient| coefficient.response(omega))
            .product();
        (low * (1.0 - self.mix) + high * self.mix) * self.scale
    }
}

pub(super) fn design(band: &EqBand, sample_rate: f64) -> BandDesign {
    if !band.enabled || band.slope_db_oct == 0.0 || band.slope_db_oct == super::BRICKWALL_SLOPE {
        return BandDesign::IDENTITY;
    }
    let mut result = BandDesign::IDENTITY;
    if matches!(
        band.shape,
        EqShape::LowCut | EqShape::HighCut | EqShape::BandPass
    ) {
        let order = band.slope_db_oct / 6.0;
        let lower = order.floor() as usize;
        let upper = order.ceil() as usize;
        result.low_count = design_cut(&mut result.low, band, sample_rate, lower);
        result.high_count = design_cut(&mut result.high, band, sample_rate, upper);
        result.mix = order.fract();
        return result;
    }
    let count = (band.slope_db_oct / 12.0).ceil() as usize;
    // Dividing gain preserves both shelf endpoints and Bell's center gain.
    let gain = band.gain_db / count as f64;
    let count = count.clamp(1, 8);
    if band.shape == EqShape::FlatTilt {
        // A bounded approximation to a straight tilt on a log-frequency axis,
        // made from eight shelving pairs spanning +/- four octaves of the pivot.
        for index in 0..8 {
            let frequency = (band.frequency_hz * 2.0_f64.powf(index as f64 - 3.5))
                .clamp(1.0, sample_rate * 0.498);
            result.low[index * 2] = rbj(
                EqShape::LowShelf,
                frequency,
                -band.gain_db / 16.0,
                FRAC_1_SQRT_2,
                sample_rate,
            );
            result.low[index * 2 + 1] = rbj(
                EqShape::HighShelf,
                frequency,
                band.gain_db / 16.0,
                FRAC_1_SQRT_2,
                sample_rate,
            );
        }
        result.low_count = 16;
        // The pivot is exactly unity at every sample rate.
        result.scale = result
            .response(2.0 * PI * band.frequency_hz / sample_rate)
            .norm()
            .recip();
    } else if band.shape == EqShape::TiltShelf {
        for index in 0..count {
            result.low[index * 2] = rbj(
                EqShape::LowShelf,
                band.frequency_hz,
                -gain / 2.0,
                band.q,
                sample_rate,
            );
            result.low[index * 2 + 1] = rbj(
                EqShape::HighShelf,
                band.frequency_hz,
                gain / 2.0,
                band.q,
                sample_rate,
            );
        }
        result.low_count = count * 2;
    } else {
        for coefficient in &mut result.low[..count] {
            *coefficient = rbj(band.shape, band.frequency_hz, gain, band.q, sample_rate);
        }
        result.low_count = count;
    }
    result.high = result.low;
    result.high_count = result.low_count;
    result
}

fn design_cut(
    output: &mut [Biquad; MAX_SECTIONS],
    band: &EqBand,
    sample_rate: f64,
    order: usize,
) -> usize {
    if band.shape == EqShape::BandPass {
        for coefficient in &mut output[..order] {
            *coefficient = rbj(
                EqShape::BandPass,
                band.frequency_hz,
                0.0,
                band.q,
                sample_rate,
            );
        }
        return order;
    }
    let mut section = 0;
    if order % 2 == 1 {
        output[section] = first_order_cut(band.shape, band.frequency_hz, sample_rate);
        section += 1;
    }
    for index in 0..order / 2 {
        let angle = (2 * index + 1) as f64 * PI / (2 * order) as f64;
        let butterworth_q = 1.0 / (2.0 * angle.sin());
        let q = butterworth_q * band.q / FRAC_1_SQRT_2;
        output[section] = rbj(band.shape, band.frequency_hz, 0.0, q, sample_rate);
        section += 1;
    }
    section
}
