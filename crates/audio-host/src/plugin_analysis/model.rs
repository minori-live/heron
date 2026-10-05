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

/// Every solver iteration uses the same FFT sizes. Keep its temporary storage
/// local to one fit so no previous transform or other analysis can leak into it.
struct Workspace {
    spectrum: Vec<Complex<f64>>,
    values: Vec<Complex<f64>>,
    scratch: Vec<Complex<f64>>,
}

impl Regression {
    fn workspace(&self) -> Workspace {
        Workspace {
            spectrum: vec![Complex::default(); self.forward.len()],
            values: vec![Complex::default(); self.forward.len()],
            scratch: vec![
                Complex::default();
                self.forward
                    .get_inplace_scratch_len()
                    .max(self.inverse.get_inplace_scratch_len())
            ],
        }
    }

    fn fft(&self, samples: &[f64], bins: &mut [Complex<f64>], scratch: &mut [Complex<f64>]) {
        bins.fill(Complex::default());
        for (bin, value) in bins.iter_mut().zip(samples) {
            bin.re = *value;
        }
        self.forward.process_with_scratch(bins, scratch);
    }

    fn adjoint(&self, output: &[f64], workspace: &mut Workspace, result: &mut [f64]) {
        self.fft(output, &mut workspace.spectrum, &mut workspace.scratch);
        self.adjoint_spectrum(workspace, result);
    }

    fn adjoint_spectrum(&self, workspace: &mut Workspace, result: &mut [f64]) {
        let size = workspace.values.len();
        for (basis, taps) in self.basis.iter().zip(result.chunks_mut(TAPS)) {
            for (value, (y, x)) in workspace
                .values
                .iter_mut()
                .zip(workspace.spectrum.iter().zip(basis))
            {
                *value = y * x.conj();
            }
            self.inverse
                .process_with_scratch(&mut workspace.values, &mut workspace.scratch);
            for (tap, value) in taps.iter_mut().zip(&workspace.values) {
                *tap = value.re / size as f64;
            }
        }
    }

    fn apply(&self, filters: &[f64], workspace: &mut Workspace, result: &mut [f64]) {
        workspace.spectrum.fill(Complex::default());
        for (filter, basis) in filters.chunks(TAPS).zip(&self.basis) {
            self.fft(filter, &mut workspace.values, &mut workspace.scratch);
            for (out, (h, x)) in workspace
                .spectrum
                .iter_mut()
                .zip(workspace.values.iter().zip(basis))
            {
                *out += h * x;
            }
        }
        self.inverse
            .process_with_scratch(&mut workspace.spectrum, &mut workspace.scratch);
        let size = workspace.spectrum.len();
        // The adjoint receives only the real, finite capture after the initial
        // transient. Clear the imaginary residual and padding before its FFT.
        for (i, value) in workspace.spectrum.iter_mut().enumerate() {
            *value = Complex::new(
                if i < TAPS || i >= self.count {
                    0.0
                } else {
                    value.re / size as f64
                },
                0.0,
            );
        }
        self.forward
            .process_with_scratch(&mut workspace.spectrum, &mut workspace.scratch);
        self.adjoint_spectrum(workspace, result);
        for (a, h) in result.iter_mut().zip(filters) {
            *a += self.regularization * h;
        }
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
    // Orthogonalize the centered powers before solving. This preserves the
    // independent power FIRs while avoiding the ill conditioning of x, x³, x⁵.
    let mut orthogonal: Vec<Vec<f64>> = Vec::new();
    let mut transforms: Vec<Vec<f64>> = Vec::new();
    for (k, power) in powers.iter().enumerate() {
        let mut values: Vec<_> = power.iter().map(|x| x - means[k]).collect();
        let mut transform = vec![0.0; powers.len()];
        transform[k] = 1.0;
        for (previous, coefficients) in orthogonal.iter().zip(&transforms) {
            let projection =
                values.iter().zip(previous).map(|(a, b)| a * b).sum::<f64>() / count as f64;
            for (value, q) in values.iter_mut().zip(previous) {
                *value -= projection * q;
            }
            for (coefficient, q) in transform.iter_mut().zip(coefficients) {
                *coefficient -= projection * q;
            }
        }
        let rms = (values.iter().map(|x| x * x).sum::<f64>() / count as f64)
            .sqrt()
            .max(1e-12);
        for value in &mut values {
            *value /= rms;
        }
        for coefficient in &mut transform {
            *coefficient /= rms;
        }
        orthogonal.push(values);
        transforms.push(transform);
    }
    let mut planner = FftPlanner::new();
    let regression = Regression {
        basis: orthogonal.iter().map(|p| spectrum(p, size)).collect(),
        forward: planner.plan_fft_forward(size),
        inverse: planner.plan_fft_inverse(size),
        count,
        regularization: count as f64 * 1e-9,
    };
    let centered_target: Vec<_> = target
        .iter()
        .enumerate()
        .map(|(i, y)| if i < TAPS { 0.0 } else { y - mean_y })
        .collect();
    let mut workspace = regression.workspace();
    let mut residual = vec![0.0; powers.len() * TAPS];
    regression.adjoint(&centered_target, &mut workspace, &mut residual);
    let mut direction = residual.clone();
    let mut filters = vec![0.0; direction.len()];
    let mut product = vec![0.0; direction.len()];
    let dot = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f64>();
    let initial = dot(&residual, &residual).max(1e-30);
    let mut energy = initial;
    // Fixed iteration and filter bounds keep identification and cancellation bounded.
    for _ in 0..48 {
        if cancel.load(Ordering::Acquire) {
            return Err(PluginAnalysisFailure::Cancelled);
        }
        regression.apply(&direction, &mut workspace, &mut product);
        let denominator = dot(&direction, &product);
        if denominator <= 1e-30 || energy / initial < 1e-12 {
            break;
        }
        let alpha = energy / denominator;
        for ((h, r), (d, a)) in filters
            .iter_mut()
            .zip(&mut residual)
            .zip(direction.iter().zip(&product))
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
    let orthogonal_filters: Vec<_> = filters.chunks(TAPS).collect();
    let filters: Vec<Vec<f64>> = (0..powers.len())
        .map(|k| {
            (0..TAPS)
                .map(|tap| {
                    orthogonal_filters
                        .iter()
                        .zip(&transforms)
                        .map(|(h, t)| h[tap] * t[k])
                        .sum()
                })
                .collect()
        })
        .collect();
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

#[cfg(test)]
mod tests {
    use super::{FftPlanner, Regression, TAPS, spectrum};

    fn direct_adjoint(basis: &[Vec<f64>], output: &[f64]) -> Vec<f64> {
        basis
            .iter()
            .flat_map(|values| {
                (0..TAPS).map(move |tap| {
                    values
                        .iter()
                        .zip(output.iter().skip(tap))
                        .map(|(x, y)| x * y)
                        .sum()
                })
            })
            .collect()
    }

    fn assert_samples_close(actual: &[f64], expected: &[f64]) {
        assert_eq!(actual.len(), expected.len());
        for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert!(
                (actual - expected).abs() < 1e-8,
                "sample {index}: actual={actual}, expected={expected}"
            );
        }
    }

    #[test]
    fn reused_workspace_preserves_the_finite_causal_regression() {
        // A non-power-of-two capture leaves a padded tail that must be cleared
        // after every inverse transform, including between different filters.
        let count = 1537usize;
        let size = (count + TAPS).next_power_of_two();
        let basis: Vec<Vec<f64>> = [23, 17]
            .into_iter()
            .map(|period| {
                (0..count)
                    .map(|index| (index % period) as f64 / period as f64 - 0.5)
                    .collect()
            })
            .collect();
        let mut planner = FftPlanner::new();
        let regression = Regression {
            basis: basis.iter().map(|values| spectrum(values, size)).collect(),
            forward: planner.plan_fft_forward(size),
            inverse: planner.plan_fft_inverse(size),
            count,
            regularization: 0.25,
        };
        let mut workspace = regression.workspace();
        let mut actual = vec![f64::NAN; basis.len() * TAPS];
        let target: Vec<_> = (0..count).map(|index| (index % 11) as f64 - 5.0).collect();
        regression.adjoint(&target, &mut workspace, &mut actual);
        assert_samples_close(&actual, &direct_adjoint(&basis, &target));

        let mut first = vec![0.0; actual.len()];
        first[0] = 0.75;
        first[17] = -0.4;
        first[TAPS - 1] = 0.1;
        first[TAPS + 3] = -0.25;
        first[TAPS * 2 - 1] = 0.2;
        let second: Vec<_> = (0..actual.len())
            .map(|index| (index % 7) as f64 / 7.0 - 0.5)
            .collect();
        let zero = vec![0.0; actual.len()];
        for filters in [&first, &second, &zero, &first] {
            let mut output = vec![0.0; count];
            for (values, filter) in basis.iter().zip(filters.chunks(TAPS)) {
                for (index, output) in output.iter_mut().enumerate().skip(TAPS) {
                    for (tap, coefficient) in filter.iter().enumerate() {
                        *output += coefficient * values[index - tap];
                    }
                }
            }
            let expected: Vec<_> = direct_adjoint(&basis, &output)
                .iter()
                .zip(filters)
                .map(|(value, filter)| value + regression.regularization * filter)
                .collect();
            regression.apply(filters, &mut workspace, &mut actual);
            assert_samples_close(&actual, &expected);
        }
        regression.adjoint(&vec![0.0; count], &mut workspace, &mut actual);
        assert!(actual.iter().all(|value| *value == 0.0));
    }
}
