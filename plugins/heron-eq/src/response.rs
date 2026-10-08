//! Cached curves evaluated from the actual prepared processor. Preparation
//! workers or the editor may call this; the audio callback never computes grids.

use heron_dsp_core::eq::{EqChannel, EqProcessor, EqResponseMatrix};

pub const RESPONSE_POINTS: usize = 256;

#[derive(Debug, Clone)]
pub struct ResponseSnapshot {
    pub generation: u64,
    pub sample_rate: f64,
    pub frequency_hz: [f64; RESPONSE_POINTS],
    pub matrix: [EqResponseMatrix; RESPONSE_POINTS],
    pub stereo_db: [f32; RESPONSE_POINTS],
    pub left_db: [f32; RESPONSE_POINTS],
    pub right_db: [f32; RESPONSE_POINTS],
    pub mid_db: [f32; RESPONSE_POINTS],
    pub side_db: [f32; RESPONSE_POINTS],
}

impl ResponseSnapshot {
    pub fn channel(&self, channel: EqChannel) -> &[f32; RESPONSE_POINTS] {
        match channel {
            EqChannel::Stereo => &self.stereo_db,
            EqChannel::Left => &self.left_db,
            EqChannel::Right => &self.right_db,
            EqChannel::Mid => &self.mid_db,
            EqChannel::Side => &self.side_db,
        }
    }
}

pub fn prepare_response(
    processor: &EqProcessor,
    sample_rate: f64,
    generation: u64,
) -> ResponseSnapshot {
    let mut response = empty_response(sample_rate, generation);
    evaluate_grid(processor, &mut response, || true);
    response
}

/// GUI preview work may be superseded during a drag. Check between frequency
/// evaluations so an obsolete grid cannot delay the latest edit or be published.
pub(crate) fn prepare_response_cancellable(
    processor: &EqProcessor,
    sample_rate: f64,
    generation: u64,
    current: impl Fn() -> bool,
) -> Option<ResponseSnapshot> {
    let mut response = empty_response(sample_rate, generation);
    evaluate_grid(processor, &mut response, current).then_some(response)
}

fn empty_response(sample_rate: f64, generation: u64) -> ResponseSnapshot {
    let high = (sample_rate * 0.499).min(30000.0);
    let frequency_hz = std::array::from_fn(|index| {
        10.0 * (high / 10.0).powf(index as f64 / (RESPONSE_POINTS - 1) as f64)
    });
    ResponseSnapshot {
        generation,
        sample_rate,
        frequency_hz,
        matrix: [EqResponseMatrix::identity(); RESPONSE_POINTS],
        stereo_db: [0.0; RESPONSE_POINTS],
        left_db: [0.0; RESPONSE_POINTS],
        right_db: [0.0; RESPONSE_POINTS],
        mid_db: [0.0; RESPONSE_POINTS],
        side_db: [0.0; RESPONSE_POINTS],
    }
}

fn evaluate_grid(
    processor: &EqProcessor,
    response: &mut ResponseSnapshot,
    current: impl Fn() -> bool,
) -> bool {
    for (index, frequency) in response.frequency_hz.into_iter().enumerate() {
        if !current() {
            return false;
        }
        let transfer = processor.response_matrix(frequency);
        response.matrix[index] = transfer;
        response.stereo_db[index] = transfer.magnitude_db(EqChannel::Stereo) as f32;
        response.left_db[index] = transfer.magnitude_db(EqChannel::Left) as f32;
        response.right_db[index] = transfer.magnitude_db(EqChannel::Right) as f32;
        response.mid_db[index] = transfer.magnitude_db(EqChannel::Mid) as f32;
        response.side_db[index] = transfer.magnitude_db(EqChannel::Side) as f32;
    }
    current()
}

#[cfg(test)]
mod tests {
    use super::*;
    use heron_dsp_core::eq::{BRICKWALL_SLOPE, EqBand, EqConfig, EqShape, ProcessingMode};

    #[test]
    fn cached_curve_reports_actual_fir_transition_instead_of_ideal_cut_step() {
        let config = EqConfig {
            bands: vec![EqBand {
                shape: EqShape::HighCut,
                frequency_hz: 4000.0,
                slope_db_oct: BRICKWALL_SLOPE,
                ..EqBand::default()
            }],
            processing_mode: ProcessingMode::LinearPhase,
            ..EqConfig::default()
        };
        let processor = EqProcessor::prepare(&config, 48000.0).expect("prepared FIR");
        let snapshot = prepare_response(&processor, 48000.0, 42);
        assert_eq!(snapshot.generation, 42);
        let nearest = snapshot
            .frequency_hz
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                ((**a / 4000.0).ln())
                    .abs()
                    .total_cmp(&((**b / 4000.0).ln()).abs())
            })
            .map(|(index, _)| index)
            .expect("curve");
        let actual = processor
            .response_matrix(snapshot.frequency_hz[nearest])
            .magnitude_db(EqChannel::Stereo);
        assert!((f64::from(snapshot.stereo_db[nearest]) - actual).abs() < 1.0e-4);
        assert!(
            snapshot
                .channel(EqChannel::Stereo)
                .iter()
                .all(|value| value.is_finite())
        );
        assert_eq!(snapshot.frequency_hz[0], 10.0);
        assert!((snapshot.frequency_hz[RESPONSE_POINTS - 1] - 23952.0).abs() < 1.0e-8);
    }
}
