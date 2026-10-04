use super::signal::{convolve, spectrum};
use heron_dsp_runtime::protocol::{PluginAnalysisFailure, PluginAnalysisModel};
use rustfft::{Fft, FftPlanner, num_complex::Complex};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

const TAPS: usize = 512;

pub(super) struct FitData<'a> {
    pub channel: u32,
    pub input: &'a [f64],
    pub output: &'a [f64],
    pub validation_input: &'a [f64],
    pub validation_output: &'a [f64],
    pub scale: f64,
    pub delay: u32,
    pub order: u32,
}

/// FFT convolution and its adjoint define the actual finite causal regression.
/// Solve all independent order filters together rather than fitting a single H.
struct Regression {
    basis: Vec<Vec<Complex<f64>>>,
    forward: Arc<dyn Fft<f64>>,
    inverse: Arc<dyn Fft<f64>>,
    count: usize,
    regularization: f64,
}
impl Regression {
    fn fft(&self, samples: &[f64]) -> Vec<Complex<f64>> {
        let mut bins = vec![Complex::default(); self.forward.len()];
        for (bin, value) in bins.iter_mut().zip(samples) {
            bin.re = *value;
        }
        self.forward.process(&mut bins);
        bins
    }
    fn adjoint(&self, output: &[f64]) -> Vec<f64> {
        let bins = self.fft(output);
        self.basis
            .iter()
            .flat_map(|basis| {
                let mut values: Vec<_> =
                    bins.iter().zip(basis).map(|(y, x)| y * x.conj()).collect();
                self.inverse.process(&mut values);
                values[..TAPS]
                    .iter()
                    .map(|v| v.re / values.len() as f64)
                    .collect::<Vec<_>>()
            })
            .collect()
    }
    fn apply(&self, filters: &[f64]) -> Vec<f64> {
        let mut output = vec![Complex::default(); self.forward.len()];
        for (filter, basis) in filters.chunks(TAPS).zip(&self.basis) {
            for (out, (h, x)) in output.iter_mut().zip(self.fft(filter).iter().zip(basis)) {
                *out += h * x;
            }
        }
        self.inverse.process(&mut output);
        let samples: Vec<_> = output[..self.count]
            .iter()
            .map(|v| v.re / output.len() as f64)
            .collect();
        self.adjoint(&samples)
            .iter()
            .zip(filters)
            .map(|(a, h)| a + self.regularization * h)
            .collect()
    }
}

pub(super) fn fit(
    data: FitData<'_>,
    cancel: &AtomicBool,
) -> Result<PluginAnalysisModel, PluginAnalysisFailure> {
    let FitData {
        channel,
        input,
        output,
        validation_input,
        validation_output,
        scale,
        delay,
        order,
    } = data;
    let delay = delay as usize;
    let count = input.len().min(output.len().saturating_sub(delay));
    if count < TAPS || scale <= 0.0 {
        return Err(PluginAnalysisFailure::InvalidSettings);
    }
    let target = &output[delay..delay + count];
    let size = (count + TAPS).next_power_of_two();
    let powers: Vec<Vec<f64>> = (1..=order)
        .map(|k| {
            input[..count]
                .iter()
                .map(|x| (x / scale).powi(k as i32))
                .collect()
        })
        .collect();
    // Center each power so an even-order DC component cannot overwhelm the fit.
    let means: Vec<_> = powers
        .iter()
        .map(|p| p.iter().sum::<f64>() / count as f64)
        .collect();
    let mean_y = target.iter().sum::<f64>() / count as f64;
    let mut planner = FftPlanner::new();
    let regression = Regression {
        basis: powers
            .iter()
            .zip(&means)
            .map(|(p, mean)| spectrum(&p.iter().map(|x| x - mean).collect::<Vec<_>>(), size))
            .collect(),
        forward: planner.plan_fft_forward(size),
        inverse: planner.plan_fft_inverse(size),
        count,
        regularization: count as f64 * 1e-9,
    };
    let mut residual = regression.adjoint(&target.iter().map(|y| y - mean_y).collect::<Vec<_>>());
    let mut direction = residual.clone();
    let mut filters = vec![0.0; direction.len()];
    let dot = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f64>();
    let initial = dot(&residual, &residual).max(1e-30);
    let mut energy = initial;
    // Fixed iteration and filter bounds keep identification and cancellation bounded.
    for _ in 0..96 {
        if cancel.load(Ordering::Acquire) {
            return Err(PluginAnalysisFailure::Cancelled);
        }
        let product = regression.apply(&direction);
        let denominator = dot(&direction, &product);
        if denominator <= 1e-30 || energy / initial < 1e-12 {
            break;
        }
        let alpha = energy / denominator;
        for ((h, r), (d, a)) in filters
            .iter_mut()
            .zip(&mut residual)
            .zip(direction.iter().zip(product))
        {
            *h += alpha * d;
            *r -= alpha * a;
        }
        let next = dot(&residual, &residual);
        for (d, r) in direction.iter_mut().zip(&residual) {
            *d = r + next / energy * *d;
        }
        energy = next;
    }
    let filters: Vec<Vec<f64>> = filters.chunks(TAPS).map(<[f64]>::to_vec).collect();
    let dc_offset = mean_y
        - filters
            .iter()
            .zip(&means)
            .map(|(h, m)| h.iter().sum::<f64>() * m)
            .sum::<f64>();
    let mut predicted = vec![dc_offset; validation_input.len()];
    for (k, filter) in filters.iter().enumerate() {
        let power: Vec<_> = validation_input
            .iter()
            .map(|x| (x / scale).powi(k as i32 + 1))
            .collect();
        for (y, v) in predicted.iter_mut().zip(convolve(&power, filter)) {
            *y += v;
        }
    }
    let observed = &validation_output[delay.min(validation_output.len())..];
    predicted.truncate(observed.len());
    let observed = &observed[..predicted.len()];
    let energy = observed.iter().map(|v| v * v).sum::<f64>();
    let error = predicted
        .iter()
        .zip(observed)
        .map(|(a, b)| (a - b).powi(2))
        .sum::<f64>();
    let percent = (error / energy.max(1e-20)).sqrt() * 100.0;
    let stride = predicted.len().div_ceil(1024).max(1);
    Ok(PluginAnalysisModel {
        channel,
        filters,
        dc_offset,
        input_scale: scale,
        delay_samples: delay as u32,
        validation_error_percent: percent,
        suitable: energy > 1e-16 && percent < 10.0,
        predicted: predicted.iter().step_by(stride).copied().collect(),
        observed: observed.iter().step_by(stride).copied().collect(),
        validation_stride: stride as u32,
    })
}
