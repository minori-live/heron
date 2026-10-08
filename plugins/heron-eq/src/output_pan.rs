//! Smoothed output balance in the L/R or M/S basis, independent of EQ state.

use heron_dsp_core::eq::{EqResponse, EqResponseMatrix};

pub struct OutputPan {
    current: [[f64; 2]; 2],
    target: [[f64; 2]; 2],
    coefficient: f64,
}

impl OutputPan {
    pub fn new(sample_rate: f64, amount: f64, mode: u8, stereo: bool) -> Self {
        let rate = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            44100.0
        };
        let target = target_matrix(amount, mode, stereo);
        Self {
            current: target,
            target,
            coefficient: 1.0 - (-1.0 / (rate * 0.005)).exp(),
        }
    }

    pub fn set_target(&mut self, amount: f64, mode: u8, stereo: bool) {
        self.target = target_matrix(amount, mode, stereo);
    }

    pub fn process(&mut self, input: [f32; 2]) -> [f32; 2] {
        for (row, target) in self.current.iter_mut().zip(self.target) {
            for (value, target) in row.iter_mut().zip(target) {
                *value += (target - *value) * self.coefficient;
            }
        }
        self.current
            .map(|row| (row[0] * f64::from(input[0]) + row[1] * f64::from(input[1])) as f32)
    }

    /// Actual current matrix, including smoothing during amount/mode changes.
    pub fn matrix(&self) -> [[f64; 2]; 2] {
        self.current
    }
}

fn target_matrix(amount: f64, mode: u8, stereo: bool) -> [[f64; 2]; 2] {
    if !stereo {
        return [[1.0, 0.0], [0.0, 1.0]];
    }
    let pan = if amount.is_finite() {
        amount.clamp(-1.0, 1.0)
    } else {
        0.0
    };
    let attenuation = |distance: f64| {
        if distance >= 1.0 {
            0.0
        } else {
            (distance * std::f64::consts::FRAC_PI_2).cos()
        }
    };
    let first = attenuation(pan.max(0.0));
    let second = attenuation((-pan).max(0.0));
    if mode == 1 {
        let diagonal = (first + second) * 0.5;
        let cross = (first - second) * 0.5;
        [[diagonal, cross], [cross, diagonal]]
    } else {
        [[first, 0.0], [0.0, second]]
    }
}

/// Compose a real output matrix after the prepared complex EQ transfer. The
/// same projection is used for both static curves and processed audio.
pub fn apply_response_matrix(eq: EqResponseMatrix, pan: [[f64; 2]; 2]) -> EqResponseMatrix {
    let mix = |first: EqResponse, second: EqResponse, row: [f64; 2]| EqResponse {
        re: first.re * row[0] + second.re * row[1],
        im: first.im * row[0] + second.im * row[1],
    };
    EqResponseMatrix {
        left_to_left: mix(eq.left_to_left, eq.left_to_right, pan[0]),
        left_to_right: mix(eq.left_to_left, eq.left_to_right, pan[1]),
        right_to_left: mix(eq.right_to_left, eq.right_to_right, pan[0]),
        right_to_right: mix(eq.right_to_left, eq.right_to_right, pan[1]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use heron_dsp_core::eq::{EqBand, EqChannel, EqConfig, EqProcessor};
    use truce_test::assert_realtime_clean;

    #[test]
    fn balance_respects_stereo_endpoints_mid_side_and_true_mono() {
        let input = [0.2, 0.8];
        assert_eq!(OutputPan::new(48000.0, 0.0, 0, true).process(input), input);
        assert_eq!(
            OutputPan::new(48000.0, -1.0, 0, true).process(input),
            [0.2, 0.0]
        );
        assert_eq!(
            OutputPan::new(48000.0, 1.0, 0, true).process(input),
            [0.0, 0.8]
        );
        let mid = OutputPan::new(48000.0, -1.0, 1, true).process(input);
        assert!((mid[0] - 0.5).abs() < 1.0e-7 && mid[0] == mid[1]);
        let side = OutputPan::new(48000.0, 1.0, 1, true).process(input);
        assert!((side[0] + 0.3).abs() < 1.0e-7 && side[0] == -side[1]);
        for mode in [0, 1] {
            assert_eq!(
                OutputPan::new(48000.0, 1.0, mode, false).process(input),
                input
            );
        }
    }

    #[test]
    fn output_matrix_transition_is_smooth_and_real_time_clean() {
        let mut pan = OutputPan::new(48000.0, 0.0, 0, true);
        assert_realtime_clean(|| {
            let _section = truce::rt::RtSection::enter();
            pan.set_target(1.0, 0, true);
            let first = pan.process([1.0, 1.0]);
            assert!(first[0] > 0.99 && first[1] == 1.0);
            for _ in 0..24000 {
                pan.process([1.0, 1.0]);
            }
            assert!(pan.process([1.0, 1.0])[0] < 1.0e-6);
            pan.set_target(-1.0, 1, true);
            let transition = pan.process([1.0, -1.0]);
            assert!(transition[0].abs() < 0.01 && (transition[1] + 1.0).abs() < 0.01);
        });
    }

    #[test]
    fn composed_pan_matrix_matches_real_mixed_channel_impulses() {
        let config = EqConfig {
            bands: vec![
                EqBand {
                    id: 1,
                    channel: EqChannel::Side,
                    gain_db: 7.0,
                    ..EqBand::default()
                },
                EqBand {
                    id: 2,
                    channel: EqChannel::Left,
                    gain_db: -5.0,
                    frequency_hz: 1700.0,
                    ..EqBand::default()
                },
            ],
            ..EqConfig::default()
        };
        for mode in [0, 1] {
            for input_channel in 0..2 {
                let mut eq = EqProcessor::prepare(&config, 48000.0).unwrap();
                let mut pan = OutputPan::new(48000.0, 0.6, mode, true);
                let transfer = apply_response_matrix(eq.response_matrix(1500.0), pan.matrix());
                let expected = if input_channel == 0 {
                    [transfer.left_to_left, transfer.left_to_right]
                } else {
                    [transfer.right_to_left, transfer.right_to_right]
                };
                let mut measured = [EqResponse { re: 0.0, im: 0.0 }; 2];
                for sample in 0..8192 {
                    let impulse = if sample == 0 { 1.0 } else { 0.0 };
                    let result = if input_channel == 0 {
                        eq.process_stereo(impulse, 0.0)
                    } else {
                        eq.process_stereo(0.0, impulse)
                    };
                    let output = pan.process([result.0, result.1]);
                    let phase = std::f64::consts::TAU * 1500.0 * sample as f64 / 48000.0;
                    for (value, sample) in measured.iter_mut().zip(output) {
                        value.re += f64::from(sample) * phase.cos();
                        value.im -= f64::from(sample) * phase.sin();
                    }
                }
                for (actual, expected) in measured.into_iter().zip(expected) {
                    assert!((actual.re - expected.re).hypot(actual.im - expected.im) < 1.0e-5);
                }
            }
        }
    }
}
