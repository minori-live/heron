use heron_dsp_runtime::protocol::{PluginAnalysisResponse, PluginAnalysisSettings};
use rustfft::{FftPlanner, num_complex::Complex};

pub(super) fn spectrum(samples: &[f64], size: usize) -> Vec<Complex<f64>> {
    let mut bins = vec![Complex::default(); size];
    for (bin, sample) in bins.iter_mut().zip(samples) {
        bin.re = *sample;
    }
    FftPlanner::new().plan_fft_forward(size).process(&mut bins);
    bins
}

pub(super) fn inverse(mut bins: Vec<Complex<f64>>) -> Vec<f64> {
    let size = bins.len();
    FftPlanner::new().plan_fft_inverse(size).process(&mut bins);
    bins.into_iter().map(|bin| bin.re / size as f64).collect()
}

pub(super) fn convolve(input: &[f64], filter: &[f64]) -> Vec<f64> {
    let size = (input.len() + filter.len()).next_power_of_two();
    let mut bins = spectrum(input, size);
    for (bin, h) in bins.iter_mut().zip(spectrum(filter, size)) {
        *bin *= h;
    }
    let mut output = inverse(bins);
    output.truncate(input.len());
    output
}

pub(super) fn sweep(settings: &PluginAnalysisSettings) -> Vec<f64> {
    let count = (settings.sweep_seconds * f64::from(settings.sample_rate)) as usize;
    let ratio = (settings.end_hz / settings.start_hz).ln();
    let peak = 10_f64.powf(settings.level_dbfs / 20.0);
    (0..count)
        .map(|index| {
            let time = index as f64 / f64::from(settings.sample_rate);
            let phase = std::f64::consts::TAU * settings.start_hz * settings.sweep_seconds / ratio
                * ((time * ratio / settings.sweep_seconds).exp() - 1.0);
            // Fade only the first/last 5 ms. The inverse uses exactly this excitation.
            let fade = (time / 0.005)
                .min((settings.sweep_seconds - time) / 0.005)
                .clamp(0.0, 1.0);
            peak * phase.sin() * fade
        })
        .collect()
}

pub(super) fn response(
    input: &[f64],
    output: &[f64],
    settings: &PluginAnalysisSettings,
    input_channel: u32,
    output_channel: u32,
) -> PluginAnalysisResponse {
    let ratio = (settings.end_hz / settings.start_hz).ln();
    let reverse: Vec<_> = input
        .iter()
        .rev()
        .enumerate()
        .map(|(i, value)| value * (-ratio * i as f64 / input.len() as f64).exp())
        .collect();
    let size = (output.len() + reverse.len()).next_power_of_two();
    let inverse_bins = spectrum(&reverse, size);
    let mut calibration = spectrum(input, size);
    for (bin, value) in calibration.iter_mut().zip(&inverse_bins) {
        *bin *= value;
    }
    let calibration = inverse(calibration);
    let origin = input.len() - 1;
    let scale = calibration[origin].max(1e-20);
    let mut bins = spectrum(output, size);
    for (bin, value) in bins.iter_mut().zip(inverse_bins) {
        *bin *= value;
    }
    let deconvolved = inverse(bins);
    let tail = (settings.tail_seconds * f64::from(settings.sample_rate)) as usize;
    // Preserve the band-limited lobe before time zero without including H2's
    // earlier ESS response. Cropping it at zero biases delayed paths' gain.
    let pre = ((0.02_f64.min(settings.sweep_seconds * 2.0_f64.ln() / ratio * 0.25))
        * f64::from(settings.sample_rate)) as usize;
    let begin = origin.saturating_sub(pre);
    let impulse: Vec<_> = deconvolved[begin..origin + tail]
        .iter()
        .map(|v| v / scale)
        .collect();
    let fft_size = impulse
        .len()
        .next_power_of_two()
        .max(settings.fft_size as usize);
    let reference = spectrum(
        &calibration[begin..origin + tail]
            .iter()
            .map(|v| v / scale)
            .collect::<Vec<_>>(),
        fft_size,
    );
    response_from_impulse(
        impulse,
        pre,
        reference,
        settings,
        input_channel,
        output_channel,
    )
}

fn response_from_impulse(
    impulse: Vec<f64>,
    pre: usize,
    reference: Vec<Complex<f64>>,
    settings: &PluginAnalysisSettings,
    input_channel: u32,
    output_channel: u32,
) -> PluginAnalysisResponse {
    let delay = impulse
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
        .map_or(0, |(index, _)| index.saturating_sub(pre));
    let fft_size = impulse
        .len()
        .next_power_of_two()
        .max(settings.fft_size as usize);
    let mut bins = spectrum(&impulse, fft_size);
    // Remove the measured delay phase before interpolation. A long delay rotates
    // adjacent bins in opposite directions, so interpolating the raw spectrum
    // cancels their sum and understates magnitude. The reported phase re-applies
    // the delay below, keeping its existing convention.
    for (bin_index, bin) in bins.iter_mut().enumerate() {
        *bin *= Complex::from_polar(
            1.0,
            std::f64::consts::TAU * bin_index as f64 * delay as f64 / fft_size as f64,
        );
    }
    let peak = impulse.iter().fold(0.0_f64, |a, b| a.max(b.abs()));
    let mut frequencies = Vec::new();
    let mut magnitudes = Vec::new();
    let mut phases = Vec::new();
    let mut previous = 0.0;
    for index in 0..384 {
        let frequency =
            settings.start_hz * (settings.end_hz / settings.start_hz).powf(index as f64 / 383.0);
        let position = frequency * fft_size as f64 / f64::from(settings.sample_rate);
        let lower = position.floor() as usize;
        let fraction = position.fract();
        // Remove excitation bandwidth and the causal analysis window's response.
        let interpolate = |bins: &[Complex<f64>]| {
            bins[lower] * (1.0 - fraction) + bins[(lower + 1).min(bins.len() - 1)] * fraction
        };
        let reference_bin = interpolate(&reference);
        let bin = interpolate(&bins) * reference_bin.conj() / reference_bin.norm_sqr().max(1e-20);
        let magnitude = 20.0 * bin.norm().max(1e-12).log10();
        let mut phase = bin.arg().to_degrees();
        if index > 0 {
            phase += ((previous - phase) / 360.0_f64).round() * 360.0;
        }
        previous = phase;
        frequencies.push(frequency);
        magnitudes.push(magnitude);
        phases.push(
            (magnitude > -100.0).then_some(
                phase - 360.0 * frequency * delay as f64 / f64::from(settings.sample_rate),
            ),
        );
    }
    let stride = impulse.len().div_ceil(4096);
    // Retain the largest signed sample in each bucket, preserving narrow delay peaks.
    let display = impulse
        .chunks(stride)
        .map(|chunk| {
            chunk
                .iter()
                .copied()
                .max_by(|a, b| a.abs().total_cmp(&b.abs()))
                .unwrap_or_default()
        })
        .collect();
    let tail_peak = impulse[impulse.len().saturating_sub(512)..]
        .iter()
        .fold(0.0_f64, |a, b| a.max(b.abs()));
    PluginAnalysisResponse {
        input: input_channel,
        output: output_channel,
        frequency_hz: frequencies,
        magnitude_db: magnitudes,
        phase_degrees: phases,
        impulse: display,
        impulse_stride: stride as u32,
        impulse_start_samples: -(pre as i32),
        delay_samples: (peak > 1e-10).then_some(delay as u32),
        tail_truncated: tail_peak > peak.max(1e-12) * 0.001,
        silence_rms: 0.0,
        repeat_error_percent: 0.0,
    }
}

pub(super) fn noise(count: usize, seed: u32, scale: f64) -> Vec<f64> {
    let mut state = seed;
    (0..count)
        .map(|index| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            let level = [0.25, 0.5, 1.0][index * 3 / count];
            (f64::from(state) / f64::from(u32::MAX) * 2.0 - 1.0) * scale * level
        })
        .collect()
}

pub(super) fn broadband_excitation(settings: &PluginAnalysisSettings) -> Vec<f64> {
    let peak = 10_f64.powf(settings.level_dbfs / 20.0);
    let count = settings.fft_size as usize * 4;
    if settings.linear_excitation == "delta" {
        let mut values = vec![0.0; count];
        values[0] = peak;
        values
    } else {
        white_noise(count, 0x91372, peak)
    }
}

pub(super) fn white_noise(count: usize, seed: u32, scale: f64) -> Vec<f64> {
    let mut state = seed;
    (0..count)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            (f64::from(state) / f64::from(u32::MAX) * 2.0 - 1.0) * scale
        })
        .collect()
}

pub(super) fn broadband_response(
    input: &[f64],
    output: &[f64],
    settings: &PluginAnalysisSettings,
    input_channel: u32,
    output_channel: u32,
) -> PluginAnalysisResponse {
    let tail = (settings.tail_seconds * f64::from(settings.sample_rate)) as usize;
    let size = (input.len() + output.len()).next_power_of_two();
    let x = spectrum(input, size);
    let y = spectrum(output, size);
    let regularization = x.iter().map(|x| x.norm_sqr()).fold(0.0_f64, f64::max) * 1e-12;
    let mut impulse = inverse(
        x.iter()
            .zip(y)
            .map(|(x, y)| y * x.conj() / (x.norm_sqr() + regularization).max(1e-30))
            .collect(),
    );
    impulse.truncate(tail);
    let fft_size = impulse
        .len()
        .next_power_of_two()
        .max(settings.fft_size as usize);
    response_from_impulse(
        impulse,
        0,
        vec![Complex::new(1.0, 0.0); fft_size],
        settings,
        input_channel,
        output_channel,
    )
}
