//! Bounded spectrum matching against the current plug-in's measured sidechain.

use heron_dsp_core::eq::{EqBand, EqConfig, EqShape, MAX_EQ_BANDS};

use crate::telemetry::SpectrumSnapshot;

pub fn interpolate(frequencies: &[f32], values: &[f32], frequency: f64) -> Option<f64> {
    if frequencies.len() != values.len() || frequencies.is_empty() {
        return None;
    }
    let position = frequencies.partition_point(|value| f64::from(*value) < frequency);
    if position == 0 {
        return Some(f64::from(values[0]));
    }
    if position == frequencies.len() {
        return Some(f64::from(*values.last()?));
    }
    let lo = f64::from(frequencies[position - 1]).ln();
    let hi = f64::from(frequencies[position]).ln();
    let amount = if hi > lo {
        (frequency.ln() - lo) / (hi - lo)
    } else {
        0.0
    };
    Some(f64::from(values[position - 1]) * (1.0 - amount) + f64::from(values[position]) * amount)
}

pub fn fit(
    source: &SpectrumSnapshot,
    reference: &SpectrumSnapshot,
) -> Result<(EqConfig, f64), String> {
    let max_frequency = (source.sample_rate * 0.45).min(20_000.0);
    let mut target = Vec::with_capacity(96);
    for step in 0..96_u16 {
        let frequency = 20.0 * (max_frequency / 20.0).powf(f64::from(step) / 95.0);
        let pre = interpolate(&source.frequency_hz, &source.pre_db, frequency).unwrap_or(-120.0);
        let post =
            interpolate(&reference.frequency_hz, &reference.post_db, frequency).unwrap_or(-120.0);
        if pre > -85.0 && post > -85.0 {
            target.push((frequency, (post - pre).clamp(-36.0, 36.0)));
        }
    }
    if target.len() < 12 {
        return Err(
            "Play broadband audio through the main input and sidechain before matching.".to_owned(),
        );
    }
    let mut gains: Vec<_> = target.iter().map(|(_, gain)| *gain).collect();
    gains.sort_by(f64::total_cmp);
    let offset = gains[gains.len() / 2];
    let mut config = EqConfig {
        output_gain_db: offset,
        ..EqConfig::default()
    };
    let mut residual: Vec<_> = target.iter().map(|(_, gain)| gain - offset).collect();
    let mut error = residual.iter().map(|value| value * value).sum::<f64>();
    for index in 0..MAX_EQ_BANDS {
        let Some((center, &gain)) = residual
            .iter()
            .enumerate()
            .max_by(|left, right| left.1.abs().total_cmp(&right.1.abs()))
        else {
            break;
        };
        if gain.abs() < 0.5 {
            break;
        }
        let frequency = target[center].0;
        let mut best = None;
        for q in [
            0.3,
            0.5,
            std::f64::consts::FRAC_1_SQRT_2,
            1.0,
            1.6,
            2.5,
            4.0,
            6.0,
        ] {
            let band = EqBand {
                id: u32::try_from(index + 1)
                    .map_err(|_| "The band limit was reached.".to_owned())?,
                shape: EqShape::Bell,
                frequency_hz: frequency,
                gain_db: gain.clamp(-30.0, 30.0),
                q,
                ..EqBand::default()
            };
            let response: Vec<_> = target
                .iter()
                .map(|(frequency, _)| band.magnitude_db(source.sample_rate, *frequency))
                .collect();
            let next_error = residual
                .iter()
                .zip(&response)
                .map(|(residual, response)| (residual - response).powi(2))
                .sum::<f64>();
            if next_error < error
                && best
                    .as_ref()
                    .is_none_or(|(_, _, best_error)| next_error < *best_error)
            {
                best = Some((band, response, next_error));
            }
        }
        let Some((band, response, next_error)) = best else {
            break;
        };
        config.bands.push(band);
        for (residual, response) in residual.iter_mut().zip(response) {
            *residual -= response;
        }
        error = next_error;
        if (error / target.len() as f64).sqrt() < 0.5 {
            break;
        }
    }
    config
        .validate(source.sample_rate)
        .map_err(|_| "The reference could not be matched at this sample rate.".to_owned())?;
    Ok((config, (error / target.len() as f64).sqrt()))
}

pub fn nearest_peak(spectrum: &SpectrumSnapshot, frequency: f64) -> Option<f64> {
    spectrum
        .frequency_hz
        .iter()
        .zip(&spectrum.pre_db)
        .filter(|(hz, db)| ((f64::from(**hz) / frequency).log2()).abs() < 0.5 && **db > -100.0)
        .max_by(|left, right| left.1.total_cmp(right.1))
        .map(|(frequency, _)| f64::from(*frequency))
}

pub fn collisions(spectrum: &SpectrumSnapshot, reference: &[f32]) -> Vec<bool> {
    let input_peak = spectrum.pre_db.iter().copied().fold(-120.0, f32::max);
    let reference_peak = reference.iter().copied().fold(-120.0, f32::max);
    spectrum
        .pre_db
        .iter()
        .zip(reference)
        .map(|(&input, &reference)| {
            input > -80.0
                && reference > -80.0
                && input > input_peak - 20.0
                && reference > reference_peak - 20.0
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use heron_dsp_core::eq::EqChannel;

    #[test]
    fn match_reduces_known_measured_response_without_exceeding_band_limit() {
        let known = EqConfig {
            bands: vec![EqBand {
                id: 1,
                frequency_hz: 1400.0,
                gain_db: 6.0,
                q: 1.2,
                ..EqBand::default()
            }],
            output_gain_db: -2.0,
            ..EqConfig::default()
        };
        let source = SpectrumSnapshot {
            sample_rate: 48_000.0,
            frequency_hz: (0..256_u16)
                .map(|index| (20.0_f64 * 1000.0_f64.powf(f64::from(index) / 255.0)) as f32)
                .collect(),
            pre_db: vec![-24.0; 256],
            ..Default::default()
        };
        let mut reference = source.clone();
        reference.post_db = source
            .frequency_hz
            .iter()
            .map(|frequency| {
                (-24.0 + known.magnitude_db(48_000.0, f64::from(*frequency), EqChannel::Stereo))
                    as f32
            })
            .collect();
        let (matched, error) = fit(&source, &reference).expect("broadband spectra");
        assert!(matched.bands.len() <= 24);
        assert!(error < 0.75, "residual {error}");
        assert!((matched.magnitude_db(48_000.0, 1400.0, EqChannel::Stereo) - 4.0).abs() < 1.0);
    }

    #[test]
    fn matching_silence_refuses_to_replace_the_current_curve() {
        assert!(fit(&SpectrumSnapshot::default(), &SpectrumSnapshot::default()).is_err());
    }
}
