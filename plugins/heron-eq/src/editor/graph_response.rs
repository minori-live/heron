//! Shared transfer-response projection for the displayed graph.

use super::*;

pub(super) fn response_path(plot: Plot, response: impl Fn(f64) -> f64) -> Path {
    Path::new(|builder| {
        for step in 0..=256_u16 {
            let x = plot.bounds.x + f32::from(step) / 256.0 * plot.bounds.width;
            let value = response(f64::from(plot.x_frequency(x)));
            if !value.is_finite() {
                continue;
            }
            let point = Point::new(
                x,
                plot.gain_y(value as f32)
                    .clamp(plot.bounds.y, plot.bounds.y + plot.bounds.height),
            );
            if step == 0 {
                builder.move_to(point);
            } else {
                builder.line_to(point);
            }
        }
    })
}

pub(super) fn prepared_db(
    response: &ResponseSnapshot,
    frequency: f64,
    channel: EqChannel,
    pan: [[f64; 2]; 2],
) -> f64 {
    if !frequency.is_finite() || frequency <= 0.0 {
        return f64::NAN;
    }
    let grid = &response.frequency_hz;
    if frequency > grid[grid.len() - 1] {
        return f64::NAN;
    }
    let value = |index| {
        crate::output_pan::apply_response_matrix(response.matrix[index], pan).magnitude_db(channel)
    };
    let index = grid.partition_point(|value| *value < frequency);
    if index == 0 {
        return value(0);
    }
    if index >= grid.len() {
        return value(grid.len() - 1);
    }
    let amount =
        (frequency.ln() - grid[index - 1].ln()) / (grid[index].ln() - grid[index - 1].ln());
    value(index - 1) * (1.0 - amount) + value(index) * amount
}

/// The yellow line projects editable static targets. A pending linear-phase
/// target has no curve until its matching finite FIR grid has been prepared.
pub(super) fn total_db(
    config: &EqConfig,
    prepared: Option<&ResponseSnapshot>,
    sample_rate: f64,
    frequency: f64,
    channel: EqChannel,
    pan: [[f64; 2]; 2],
    visible: bool,
) -> Option<f64> {
    if config.bypass {
        return Some(0.0);
    }
    if !visible {
        return None;
    }
    if config.processing_mode == heron_dsp_core::eq::ProcessingMode::LinearPhase {
        prepared
            .map(|response| prepared_db(response, frequency, channel, pan) + config.output_gain_db)
    } else {
        Some(
            crate::output_pan::apply_response_matrix(
                config.response_matrix(sample_rate, frequency),
                pan,
            )
            .magnitude_db(channel),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use heron_dsp_core::eq::{EqBand, EqProcessor, LinearPhaseResolution, ProcessingMode};

    #[test]
    fn editable_iir_total_changes_without_any_accepted_audio_snapshot() {
        let pan = [[1.0, 0.0], [0.0, 1.0]];
        let mut config = EqConfig::default();
        assert_eq!(
            total_db(&config, None, 48000.0, 1500.0, EqChannel::Stereo, pan, true),
            Some(0.0)
        );
        config.bands.push(EqBand {
            gain_db: 6.0,
            frequency_hz: 1500.0,
            ..EqBand::default()
        });
        let added = total_db(&config, None, 48000.0, 1500.0, EqChannel::Stereo, pan, true).unwrap();
        assert!((added - 6.0).abs() < 1.0e-9);
        config.bands[0].gain_db = -9.0;
        let edited =
            total_db(&config, None, 48000.0, 1500.0, EqChannel::Stereo, pan, true).unwrap();
        assert!((edited + 9.0).abs() < 1.0e-9);
    }

    #[test]
    fn prepared_total_composes_current_trim_and_pan_once_and_pending_fir_has_no_ideal_line() {
        let core = EqConfig {
            bands: vec![EqBand {
                gain_db: 6.0,
                frequency_hz: 1500.0,
                ..EqBand::default()
            }],
            processing_mode: ProcessingMode::LinearPhase,
            linear_phase_resolution: LinearPhaseResolution::Low,
            ..EqConfig::default()
        };
        let processor = EqProcessor::prepare(&core, 48000.0).unwrap();
        let response = crate::response::prepare_response(&processor, 48000.0, 1);
        let mut config = core;
        config.output_gain_db = -3.0;
        let pan = [[0.0, 0.0], [0.0, 1.0]];
        assert_eq!(
            total_db(&config, None, 48000.0, 1500.0, EqChannel::Stereo, pan, true),
            None
        );
        let index = 165;
        let frequency = response.frequency_hz[index];
        let expected =
            crate::output_pan::apply_response_matrix(processor.response_matrix(frequency), pan)
                .magnitude_db(EqChannel::Stereo)
                - 3.0;
        let actual = total_db(
            &config,
            Some(&response),
            48000.0,
            frequency,
            EqChannel::Stereo,
            pan,
            true,
        )
        .unwrap();
        assert!((actual - expected).abs() < 1.0e-10);
        config.bypass = true;
        assert_eq!(
            total_db(
                &config,
                None,
                48000.0,
                frequency,
                EqChannel::Stereo,
                pan,
                false
            ),
            Some(0.0)
        );
    }
}
