mod dynamics;
mod model;
mod tone;
mod worker;
pub(crate) use worker::{PluginAnalysisJobs, failed};
mod performance;
mod signal;
mod spectrogram;
#[cfg(test)]
mod tests;

use heron_audio_plugin::{
    AudioPluginProcessorHandle, AudioPortToken, PluginProcessFailure, ProcessContext,
    SidechainSource,
};
use heron_dsp_runtime::protocol::{
    PluginAnalysisBlockPerformance, PluginAnalysisDistortion, PluginAnalysisDynamics,
    PluginAnalysisDynamicsPoint, PluginAnalysisFailure, PluginAnalysisHarmonics,
    PluginAnalysisJobStatus, PluginAnalysisOscilloscope, PluginAnalysisOscilloscopeWaveform,
    PluginAnalysisPerformance, PluginAnalysisReport, PluginAnalysisSettings,
    PluginAnalysisSpectrum,
};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

struct EmptySidechains;
impl SidechainSource for EmptySidechains {
    fn frames(&self, _: AudioPortToken) -> Option<&[[f32; 2]]> {
        None
    }
}

/// Selects how a mono excitation drives the stereo input and how the stereo
/// output is folded back to one measurement channel.
#[derive(Clone, Copy)]
enum StereoRoute {
    Channel(usize),
    Mid,
    Side,
}

impl StereoRoute {
    fn gains(self) -> (f64, f64) {
        match self {
            Self::Channel(0) => (1.0, 0.0),
            Self::Channel(_) => (0.0, 1.0),
            Self::Mid => (1.0, 1.0),
            Self::Side => (1.0, -1.0),
        }
    }

    fn measure(self, frame: [f64; 2]) -> f64 {
        match self {
            Self::Channel(channel) => frame[channel],
            Self::Mid => 0.5 * (frame[0] + frame[1]),
            Self::Side => 0.5 * (frame[0] - frame[1]),
        }
    }

    fn index(self) -> u32 {
        match self {
            Self::Channel(0) | Self::Mid => 0,
            Self::Channel(_) | Self::Side => 1,
        }
    }
}

/// Amplitude at `order * cycles` for a capture that is an exact number of cycles
/// long, so the single-bin lock-in is leakage free.
fn lock_in(samples: &[f64], cycles: f64, order: usize, length: usize) -> f64 {
    let mut real = 0.0;
    let mut imaginary = 0.0;
    for (index, sample) in samples.iter().enumerate() {
        let phase = std::f64::consts::TAU * cycles * order as f64 * index as f64 / length as f64;
        real += sample * phase.cos();
        imaginary += sample * phase.sin();
    }
    real.hypot(imaginary) * 2.0 / length as f64
}

struct Chain {
    processors: Vec<AudioPluginProcessorHandle>,
    comparison_processors: Option<Vec<AudioPluginProcessorHandle>>,
    settings: PluginAnalysisSettings,
    cancel: Arc<AtomicBool>,
    clock: i64,
    times: Vec<f64>,
}

impl Drop for Chain {
    fn drop(&mut self) {
        for processor in self
            .processors
            .iter_mut()
            .chain(self.comparison_processors.iter_mut().flatten())
        {
            processor.retire();
        }
    }
}

impl Chain {
    fn capture(
        &mut self,
        input: &[f64],
        channel: usize,
        tail: usize,
        timed: bool,
    ) -> Result<Vec<[f64; 2]>, PluginAnalysisFailure> {
        self.capture_route(input, StereoRoute::Channel(channel), tail, timed)
    }

    fn capture_route(
        &mut self,
        input: &[f64],
        route: StereoRoute,
        tail: usize,
        timed: bool,
    ) -> Result<Vec<[f64; 2]>, PluginAnalysisFailure> {
        let (left_gain, right_gain) = route.gains();
        let total = input.len() + tail;
        let mut output = Vec::with_capacity(total);
        let mut block = vec![[0.0_f32; 2]; self.settings.block_size as usize];
        let mut comparison = vec![[0.0_f32; 2]; block.len()];
        let capture_started = Instant::now();
        for offset in (0..total).step_by(block.len()) {
            if self.cancel.load(Ordering::Acquire) {
                return Err(PluginAnalysisFailure::Cancelled);
            }
            let count = (total - offset).min(block.len());
            for (i, frame) in block.iter_mut().enumerate() {
                let value = input.get(offset + i).copied().unwrap_or_default() as f32;
                *frame = [value * left_gain as f32, value * right_gain as f32];
            }
            let context = ProcessContext {
                project_time_samples: self.clock,
                continuous_time_samples: self.clock,
                steady_time_samples: self.clock,
                project_time_quarters: self.clock as f64 / f64::from(self.settings.sample_rate)
                    * 2.0,
                bar_position_quarters: 0.0,
                tempo: 120.0,
                time_signature_numerator: 4,
                time_signature_denominator: 4,
                playing: true,
                recording: false,
                loop_active: false,
                loop_start_quarters: 0.0,
                loop_end_quarters: 0.0,
            };
            if self.comparison_processors.is_some() {
                comparison.copy_from_slice(&block);
            }
            let started = Instant::now();
            for processor in &mut self.processors {
                if !processor.process_block(&mut block, &EmptySidechains, &context) {
                    return Err(
                        if processor
                            .take_unreported_process_failure()
                            .is_some_and(|failure| {
                                failure.failure == PluginProcessFailure::InvalidOutput
                            })
                        {
                            PluginAnalysisFailure::InvalidOutput
                        } else {
                            PluginAnalysisFailure::ProcessorRejected
                        },
                    );
                }
            }
            if let Some(processors) = &mut self.comparison_processors {
                for processor in processors {
                    if !processor.process_block(&mut comparison, &EmptySidechains, &context) {
                        return Err(PluginAnalysisFailure::ProcessorRejected);
                    }
                }
                for (frame, other) in block.iter_mut().zip(&comparison) {
                    frame[0] -= other[0];
                    frame[1] -= other[1];
                }
            }
            if timed {
                self.times.push(started.elapsed().as_secs_f64() * 1e6);
            }
            if block
                .iter()
                .any(|frame| frame.iter().any(|v| !v.is_finite()))
            {
                return Err(PluginAnalysisFailure::InvalidOutput);
            }
            output.extend(
                block[..count]
                    .iter()
                    .map(|f| [f64::from(f[0]), f64::from(f[1])]),
            );
            self.clock += block.len() as i64;
            // Pacing belongs to the measurement worker, never the device callback.
            let multiplier = match self.settings.processing_speed.as_str() {
                "realtime" => 1.0,
                "x2" => 2.0,
                "x4" => 4.0,
                _ => 0.0,
            };
            if multiplier > 0.0 {
                let target = std::time::Duration::from_secs_f64(
                    (offset + block.len()) as f64
                        / f64::from(self.settings.sample_rate)
                        / multiplier,
                );
                while capture_started.elapsed() < target {
                    if self.cancel.load(Ordering::Acquire) {
                        return Err(PluginAnalysisFailure::Cancelled);
                    }
                    std::thread::sleep(
                        (target.saturating_sub(capture_started.elapsed()))
                            .min(std::time::Duration::from_millis(2)),
                    );
                }
            }
        }
        Ok(output)
    }

    fn settle(&mut self) -> Result<(), PluginAnalysisFailure> {
        let count = (self.settings.tail_seconds * f64::from(self.settings.sample_rate)) as usize;
        self.capture(&[], 0, count, false).map(|_| ())
    }
}
