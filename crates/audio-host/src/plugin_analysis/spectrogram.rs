use heron_dsp_runtime::protocol::{
    PluginAnalysisFailure, PluginAnalysisSettings, PluginAnalysisSpectrogram,
};
use rustfft::{FftPlanner, num_complex::Complex};
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) fn linear_sweep(settings: &PluginAnalysisSettings) -> Vec<f64> {
    let rate = f64::from(settings.sample_rate);
    let peak = 10_f64.powf(settings.level_dbfs / 20.0);
    let slope = (settings.end_hz - settings.start_hz) / settings.sweep_seconds;
    (0..(settings.sweep_seconds * rate) as usize)
        .map(|i| {
            let time = i as f64 / rate;
            let phase =
                std::f64::consts::TAU * (settings.start_hz * time + 0.5 * slope * time * time);
            let fade = (time / 0.005)
                .min((settings.sweep_seconds - time) / 0.005)
                .clamp(0.0, 1.0);
            peak * phase.sin() * fade
        })
        .collect()
}

pub(super) fn measure(
    output: &[f64],
    settings: &PluginAnalysisSettings,
    channel: u32,
    logarithmic_sweep: bool,
    cancel: &AtomicBool,
) -> Result<PluginAnalysisSpectrogram, PluginAnalysisFailure> {
    let fft_size = self_quality(settings);
    const COLUMNS: usize = 192;
    const ROWS: usize = 512;
    let bins_per_row = fft_size / 2 / ROWS;
    let window: Vec<_> = (0..fft_size)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / fft_size as f64).cos())
        .collect();
    let window_sum = window.iter().sum::<f64>();
    let fft = FftPlanner::new().plan_fft_forward(fft_size);
    let mut bins = vec![Complex::default(); fft_size];
    let mut scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
    let mut values = Vec::with_capacity(COLUMNS * ROWS);
    let frames = settings.sweep_seconds * f64::from(settings.sample_rate);
    for column in 0..COLUMNS {
        if cancel.load(Ordering::Acquire) {
            return Err(PluginAnalysisFailure::Cancelled);
        }
        let center = (frames * column as f64 / (COLUMNS - 1) as f64).round() as isize;
        for (i, bin) in bins.iter_mut().enumerate() {
            let index = center + i as isize - fft_size as isize / 2;
            let value = if index >= 0 {
                output.get(index as usize).copied().unwrap_or(0.0)
            } else {
                0.0
            };
            *bin = Complex::new(value * window[i], 0.0);
        }
        fft.process_with_scratch(&mut bins, &mut scratch);
        // Keep each band's maximum, preserving narrow harmonics and reflected aliasing.
        // Values come from the measured output, including energy between harmonic orders.
        for row in 0..ROWS {
            let first = row * bins_per_row;
            // The one-sided factor of two applies to non-DC bins only; doubling the
            // DC bin reports a constant output as +6 dBFS instead of 0 dBFS.
            let amplitude = bins[first..first + bins_per_row].iter().enumerate().fold(
                0.0_f64,
                |peak, (offset, bin)| {
                    let scale = if first + offset == 0 { 1.0 } else { 2.0 };
                    peak.max(bin.norm() * scale)
                },
            ) / window_sum;
            values.push((20.0 * amplitude.max(1e-8).log10()) as f32);
        }
    }
    Ok(PluginAnalysisSpectrogram {
        channel,
        logarithmic_sweep,
        columns: COLUMNS as u32,
        rows: ROWS as u32,
        duration_seconds: settings.sweep_seconds,
        maximum_frequency_hz: f64::from(settings.sample_rate) * 0.5,
        magnitude_dbfs: values,
    })
}

fn self_quality(settings: &PluginAnalysisSettings) -> usize {
    settings.fft_size as usize / 4
}
