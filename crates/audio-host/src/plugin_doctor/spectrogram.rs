use heron_dsp_runtime::protocol::{DoctorFailure, DoctorSettings, DoctorSpectrogram};
use rustfft::{FftPlanner, num_complex::Complex};
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) fn linear_sweep(settings: &DoctorSettings) -> Vec<f64> {
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
    output: &[[f64; 2]],
    settings: &DoctorSettings,
    channel: usize,
    logarithmic_sweep: bool,
    cancel: &AtomicBool,
) -> Result<DoctorSpectrogram, DoctorFailure> {
    const FFT_SIZE: usize = 4096;
    const COLUMNS: usize = 192;
    const ROWS: usize = 512;
    const BINS_PER_ROW: usize = FFT_SIZE / 2 / ROWS;
    let window: Vec<_> = (0..FFT_SIZE)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / FFT_SIZE as f64).cos())
        .collect();
    let normalization = 2.0 / window.iter().sum::<f64>();
    let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
    let mut bins = vec![Complex::default(); FFT_SIZE];
    let mut scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
    let mut values = Vec::with_capacity(COLUMNS * ROWS);
    let frames = settings.sweep_seconds * f64::from(settings.sample_rate);
    for column in 0..COLUMNS {
        if cancel.load(Ordering::Acquire) {
            return Err(DoctorFailure::Cancelled);
        }
        let center = (frames * column as f64 / (COLUMNS - 1) as f64).round() as isize;
        for (i, bin) in bins.iter_mut().enumerate() {
            let index = center + i as isize - FFT_SIZE as isize / 2;
            let value = if index >= 0 {
                output
                    .get(index as usize)
                    .map_or(0.0, |frame| frame[channel])
            } else {
                0.0
            };
            *bin = Complex::new(value * window[i], 0.0);
        }
        fft.process_with_scratch(&mut bins, &mut scratch);
        // Keep each band's maximum, preserving narrow harmonics and reflected aliasing.
        // Values come from the measured output, including energy between harmonic orders.
        for row in 0..ROWS {
            let first = row * BINS_PER_ROW;
            let amplitude = bins[first..first + BINS_PER_ROW]
                .iter()
                .fold(0.0_f64, |peak, bin| peak.max(bin.norm()))
                * normalization;
            values.push((20.0 * amplitude.max(1e-8).log10()) as f32);
        }
    }
    Ok(DoctorSpectrogram {
        channel: channel as u32,
        logarithmic_sweep,
        columns: COLUMNS as u32,
        rows: ROWS as u32,
        duration_seconds: settings.sweep_seconds,
        maximum_frequency_hz: f64::from(settings.sample_rate) * 0.5,
        magnitude_dbfs: values,
    })
}
