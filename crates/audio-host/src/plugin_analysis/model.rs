use super::signal::{convolve, inverse, spectrum};
use heron_dsp_runtime::protocol::PluginAnalysisFailure;
use heron_dsp_runtime::protocol::PluginAnalysisModel;
use std::sync::atomic::{AtomicBool, Ordering};

const ORDER: usize = 5;
const TAPS: usize = 512;

fn solve(mut matrix: [[f64; ORDER + 1]; ORDER]) -> Option<[f64; ORDER]> {
    for col in 0..ORDER {
        let pivot =
            (col..ORDER).max_by(|a, b| matrix[*a][col].abs().total_cmp(&matrix[*b][col].abs()))?;
        matrix.swap(col, pivot);
        let scale = matrix[col][col];
        if scale.abs() < 1e-15 {
            return None;
        }
        for item in &mut matrix[col][col..] {
            *item /= scale;
        }
        let pivot_values = matrix[col];
        for (row, values) in matrix.iter_mut().enumerate() {
            if row == col {
                continue;
            }
            let gain = values[col];
            for (value, pivot) in values[col..].iter_mut().zip(&pivot_values[col..]) {
                *value -= gain * pivot;
            }
        }
    }
    Some(std::array::from_fn(|i| matrix[i][ORDER]))
}

pub(super) struct FitData<'a> {
    pub channel: u32,
    pub input: &'a [f64],
    pub output: &'a [f64],
    pub validation_input: &'a [f64],
    pub validation_output: &'a [f64],
    pub scale: f64,
    pub delay: u32,
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
    } = data;
    let delay = delay as usize;
    let count = input.len().min(output.len().saturating_sub(delay));
    let input = &input[..count];
    let target = &output[delay..delay + count];
    let basis: Vec<Vec<f64>> = (1..=ORDER)
        .map(|order| {
            input
                .iter()
                .map(|v| (v / scale).powi(order as i32))
                .collect()
        })
        .collect();
    let mut coefficients = [0.0; ORDER];
    coefficients[0] = 1.0;
    let mut filter = vec![0.0; TAPS];
    filter[0] = scale;
    for _ in 0..12 {
        if cancel.load(Ordering::Acquire) {
            return Err(PluginAnalysisFailure::Cancelled);
        }
        let filtered: Vec<_> = basis.iter().map(|b| convolve(b, &filter)).collect();
        let mut matrix = [[0.0; ORDER + 1]; ORDER];
        for row in 0..ORDER {
            for col in 0..ORDER {
                matrix[row][col] = filtered[row]
                    .iter()
                    .zip(&filtered[col])
                    .map(|(a, b)| a * b)
                    .sum();
            }
            matrix[row][row] += 1e-8 * count as f64;
            matrix[row][ORDER] = filtered[row].iter().zip(target).map(|(a, b)| a * b).sum();
        }
        if let Some(next) = solve(matrix) {
            coefficients = next;
        }
        let nonlinear: Vec<_> = (0..count)
            .map(|i| (0..ORDER).map(|k| coefficients[k] * basis[k][i]).sum())
            .collect();
        let size = (count * 2).next_power_of_two();
        let x = spectrum(&nonlinear, size);
        let y = spectrum(target, size);
        let regularization = x.iter().map(|v| v.norm_sqr()).fold(0.0_f64, f64::max) * 1e-9 + 1e-15;
        filter = inverse(
            x.iter()
                .zip(y)
                .map(|(x, y)| y * x.conj() / (x.norm_sqr() + regularization))
                .collect(),
        );
        filter.truncate(TAPS);
    }
    // Pin the linear coefficient to one when identifiable; move its scale to H.
    if coefficients[0].abs() > 1e-8 {
        let gain = coefficients[0];
        for c in &mut coefficients {
            *c /= gain;
        }
        for h in &mut filter {
            *h *= gain;
        }
    }
    let nonlinear: Vec<_> = validation_input
        .iter()
        .map(|x| {
            coefficients
                .iter()
                .enumerate()
                .map(|(i, c)| c * (x / scale).powi((i + 1) as i32))
                .sum()
        })
        .collect();
    let mut predicted = convolve(&nonlinear, &filter);
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
        coefficients: coefficients.to_vec(),
        input_scale: scale,
        filter,
        delay_samples: delay as u32,
        validation_error_percent: percent,
        suitable: energy > 1e-16 && percent < 10.0,
        predicted: predicted.iter().step_by(stride).copied().collect(),
        observed: observed.iter().step_by(stride).copied().collect(),
        validation_stride: stride as u32,
    })
}
