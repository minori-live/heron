//! Uniform partitioned convolution. All FFT buffers and plans are prepared
//! before processing; the sample callback performs no allocation or locking.

use super::{EqConfig, EqResponseMatrix, response::raw_matrix};
use rustfft::{Fft, FftPlanner, num_complex::Complex64};
use std::{f64::consts::PI, sync::Arc};

pub(super) const BLOCK: usize = 256;
const FFT: usize = BLOCK * 2;

pub(super) struct LinearConvolver {
    kernel: [Vec<f64>; 4],
    spectra: [Vec<Complex64>; 4],
    history: [Vec<Complex64>; 2],
    previous: [[f64; BLOCK]; 2],
    input: [[f64; BLOCK]; 2],
    output: [[f64; BLOCK]; 2],
    working: [Vec<Complex64>; 2],
    scratch: Vec<Complex64>,
    forward: Arc<dyn Fft<f64>>,
    inverse: Arc<dyn Fft<f64>>,
    cursor: usize,
    partition: usize,
    partitions: usize,
}

impl LinearConvolver {
    pub fn prepare(config: &EqConfig, sample_rate: f64) -> Self {
        let mut planner = FftPlanner::new();
        let kernel = design_kernel(config, sample_rate, &mut planner);
        let partitions = config.linear_phase_resolution.taps().div_ceil(BLOCK);
        let forward = planner.plan_fft_forward(FFT);
        let inverse = planner.plan_fft_inverse(FFT);
        let mut scratch = vec![
            Complex64::default();
            forward
                .get_inplace_scratch_len()
                .max(inverse.get_inplace_scratch_len())
        ];
        let mut spectra: [Vec<Complex64>; 4] =
            std::array::from_fn(|_| vec![Complex64::default(); partitions * FFT]);
        for (path, spectrum) in spectra.iter_mut().enumerate() {
            for partition in 0..partitions {
                let block = &mut spectrum[partition * FFT..(partition + 1) * FFT];
                for (index, value) in block.iter_mut().enumerate().take(BLOCK) {
                    value.re = kernel[path]
                        .get(partition * BLOCK + index)
                        .copied()
                        .unwrap_or(0.0);
                }
                forward.process_with_scratch(block, &mut scratch);
            }
        }
        Self {
            kernel,
            spectra,
            history: std::array::from_fn(|_| vec![Complex64::default(); partitions * FFT]),
            previous: [[0.0; BLOCK]; 2],
            input: [[0.0; BLOCK]; 2],
            output: [[0.0; BLOCK]; 2],
            working: std::array::from_fn(|_| vec![Complex64::default(); FFT]),
            scratch,
            forward,
            inverse,
            cursor: 0,
            partition: 0,
            partitions,
        }
    }

    pub fn process(&mut self, left: f64, right: f64) -> (f64, f64) {
        let output = (self.output[0][self.cursor], self.output[1][self.cursor]);
        self.input[0][self.cursor] = left;
        self.input[1][self.cursor] = right;
        self.cursor += 1;
        if self.cursor == BLOCK {
            self.process_partition();
            self.cursor = 0;
        }
        output
    }

    fn process_partition(&mut self) {
        for channel in 0..2 {
            let spectrum =
                &mut self.history[channel][self.partition * FFT..(self.partition + 1) * FFT];
            for index in 0..BLOCK {
                spectrum[index] = Complex64::new(self.previous[channel][index], 0.0);
                spectrum[index + BLOCK] = Complex64::new(self.input[channel][index], 0.0);
            }
            self.forward
                .process_with_scratch(spectrum, &mut self.scratch);
            self.previous[channel] = self.input[channel];
        }
        for output in 0..2 {
            self.working[output].fill(Complex64::default());
            for input in 0..2 {
                let kernels = &self.spectra[output * 2 + input];
                for partition in 0..self.partitions {
                    let history_index =
                        (self.partition + self.partitions - partition) % self.partitions;
                    let history =
                        &self.history[input][history_index * FFT..(history_index + 1) * FFT];
                    let kernel = &kernels[partition * FFT..(partition + 1) * FFT];
                    for index in 0..FFT {
                        self.working[output][index] += history[index] * kernel[index];
                    }
                }
            }
            self.inverse
                .process_with_scratch(&mut self.working[output], &mut self.scratch);
            for index in 0..BLOCK {
                self.output[output][index] = self.working[output][index + BLOCK].re / FFT as f64;
            }
        }
        self.partition = (self.partition + 1) % self.partitions;
    }

    pub fn response_matrix(&self, sample_rate: f64, frequency_hz: f64) -> EqResponseMatrix {
        let omega = 2.0 * PI * frequency_hz / sample_rate;
        let delay = Complex64::from_polar(1.0, -omega * BLOCK as f64);
        let paths: [Complex64; 4] = std::array::from_fn(|path| {
            self.kernel[path]
                .iter()
                .enumerate()
                .map(|(index, value)| Complex64::from_polar(*value, -omega * index as f64))
                .sum::<Complex64>()
                * delay
        });
        EqResponseMatrix {
            left_to_left: paths[0].into(),
            right_to_left: paths[1].into(),
            left_to_right: paths[2].into(),
            right_to_right: paths[3].into(),
        }
    }
}

fn design_kernel(
    config: &EqConfig,
    sample_rate: f64,
    planner: &mut FftPlanner<f64>,
) -> [Vec<f64>; 4] {
    let taps = config.linear_phase_resolution.taps();
    let center = taps / 2;
    let design_fft = (taps * 4).next_power_of_two();
    let inverse = planner.plan_fft_inverse(design_fft);
    let mut spectra: [Vec<Complex64>; 4] =
        std::array::from_fn(|_| vec![Complex64::default(); design_fft]);
    for index in 0..=design_fft / 2 {
        let omega = 2.0 * PI * index as f64 / design_fft as f64;
        let matrix = raw_matrix(config, sample_rate, omega, true);
        for (output, row) in matrix.iter().enumerate() {
            for (input, entry) in row.iter().enumerate() {
                let path = output * 2 + input;
                spectra[path][index] = *entry;
                if index > 0 && index < design_fft / 2 {
                    spectra[path][design_fft - index] = entry.conj();
                }
            }
        }
    }
    for spectrum in &mut spectra {
        inverse.process(spectrum);
    }
    std::array::from_fn(|path| {
        (0..taps)
            .map(|index| {
                let source = (index + design_fft - center) % design_fft;
                // Blackman truncation controls ringing without changing symmetry.
                let phase = 2.0 * PI * index as f64 / (taps - 1) as f64;
                let window = 0.42 - 0.5 * phase.cos() + 0.08 * (2.0 * phase).cos();
                spectra[path][source].re / design_fft as f64 * window
            })
            .collect()
    })
}
