use super::lifecycle_types::invalid_config;
use super::resolve::resolve_graph;
use super::{
    AudioEngine, EngineCommand, MAX_OUTPUT_CHANNELS, MAX_PLUGIN_BLOCK_FRAMES, TransportAction,
    compile_graph_build,
};
use crate::{EngineError, EngineResult};
use bwavfile::{WAVE_TAG_FLOAT, WaveFmt, WaveWriter};
use heron_audio_plugin::AudioPluginProcessorHandle;
use heron_dsp_runtime::protocol::{LiveMixerGraph, TrackFreezeMode};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

const TAIL_SILENCE_AMPLITUDE: f32 = 0.000_031_622_777;
const MAX_TAIL_SECONDS: u64 = 30;

pub struct TrackFreezeRequest {
    pub graph: LiveMixerGraph,
    pub revision: u64,
    pub plugin_slots: HashMap<String, AudioPluginProcessorHandle>,
    pub channel_id: String,
    pub mode: TrackFreezeMode,
    pub start_frame: u64,
    pub end_frame: u64,
    pub output_path: PathBuf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrackFreezeProgress {
    Preparing,
    Rendering {
        completed_frames: u64,
        total_frames: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackFreezeResult {
    pub rendered_frames: u64,
    pub content_frames: u64,
    pub tail_frames: u64,
    pub latency_samples: u32,
    pub tail_truncated: bool,
    pub sample_rate: u32,
}

fn freeze_error(context: &str, error: impl std::fmt::Display) -> EngineError {
    EngineError::State(format!("{context}: {error}"))
}

/// Isolate one track at unity, with baked plug-ins kept or removed by mode.
///
/// The returned latency is the sum of plug-ins that remain on the track. Those
/// plug-ins are expected to delay internally; this render does not add another
/// compensation offset. Hardware outputs are scaled by the master channel, so
/// master stays unmuted at unity and is not printed into the freeze file.
fn isolate_track(
    graph: &mut LiveMixerGraph,
    channel_id: &str,
    mode: TrackFreezeMode,
) -> EngineResult<u32> {
    if !graph
        .channels
        .iter()
        .any(|channel| channel.id == channel_id)
    {
        return Err(EngineError::InvalidConfiguration(
            "freeze track channel was not found".to_owned(),
        ));
    }
    let routed_output = graph
        .channels
        .iter()
        .find(|channel| channel.id == channel_id)
        .and_then(|channel| channel.output_channel_id.clone())
        .filter(|output_id| {
            graph
                .channels
                .iter()
                .any(|channel| channel.id == *output_id && channel.kind == "output")
        });
    let output_id = routed_output
        .or_else(|| {
            graph
                .channels
                .iter()
                .find(|channel| channel.kind == "output")
                .map(|channel| channel.id.clone())
        })
        .ok_or_else(|| {
            EngineError::InvalidConfiguration("freeze requires an Output channel".to_owned())
        })?;
    graph.latency_policy = heron_dsp_runtime::protocol::LiveLatencyPolicy::Normal;
    graph
        .sends
        .retain(|send| send.source_channel_id != channel_id);
    if mode == TrackFreezeMode::SourceOnly {
        graph
            .plugins
            .retain(|plugin| plugin.channel_id != channel_id || plugin.role == "instrument");
    }
    let latency_samples = graph
        .plugins
        .iter()
        .filter(|plugin| plugin.channel_id == channel_id)
        .fold(0_u32, |sum, plugin| {
            sum.saturating_add(plugin.latency_samples)
        });
    for channel in &mut graph.channels {
        channel.record_armed = false;
        channel.input_monitoring = false;
        channel.soloed = false;
        if channel.id == channel_id {
            channel.gain_db = 0.0;
            channel.pan = 0.0;
            channel.muted = false;
            channel.output_channel_id = Some(output_id.clone());
            channel.output_bus = None;
            channel.output_format = None;
            channel.hardware_output_channels.clear();
        } else if channel.id == output_id || channel.kind == "master" {
            channel.gain_db = 0.0;
            channel.pan = 0.0;
            channel.muted = false;
            if channel.id == output_id {
                channel.hardware_output_channels = vec![1, 2];
            } else {
                channel.hardware_output_channels.clear();
            }
        } else {
            channel.muted = true;
            channel.hardware_output_channels.clear();
        }
    }
    Ok(latency_samples)
}

pub fn render_track_freeze(
    mut request: TrackFreezeRequest,
    cancel: &AtomicBool,
    mut progress: impl FnMut(TrackFreezeProgress),
) -> EngineResult<TrackFreezeResult> {
    if request.start_frame >= request.end_frame || request.graph.sample_rate == 0 {
        return Err(EngineError::InvalidConfiguration(
            "invalid track freeze range or sample rate".to_owned(),
        ));
    }
    progress(TrackFreezeProgress::Preparing);
    let latency_samples = isolate_track(&mut request.graph, &request.channel_id, request.mode)?;
    let source_rate = request.graph.sample_rate;
    let resolved = resolve_graph(request.revision, &request.graph).map_err(invalid_config)?;
    let engine = AudioEngine::new();
    engine.set_plugin_processors(request.plugin_slots);
    let built = compile_graph_build(engine.begin_resolved_build(resolved)?)?;
    let mut runtime = built.runtime;
    let known_tail = runtime.tail_end_frame.map(|end| {
        end.saturating_sub(runtime.content_end_frame)
            .min(u64::from(source_rate) * MAX_TAIL_SECONDS)
    });
    let maximum_tail = u64::from(source_rate) * MAX_TAIL_SECONDS;
    let tail_limit = known_tail.unwrap_or(maximum_tail).min(maximum_tail);
    let content_frames = request.end_frame - request.start_frame;
    runtime.project_end_frame = request.end_frame.saturating_add(tail_limit);
    runtime.handle_command(EngineCommand::Transport(
        TransportAction::Seek,
        request.start_frame,
    ));
    runtime.handle_command(EngineCommand::Transport(
        TransportAction::Play,
        request.start_frame,
    ));
    let writer = WaveWriter::create(
        &request.output_path,
        WaveFmt {
            tag: WAVE_TAG_FLOAT,
            channel_count: 2,
            sample_rate: source_rate,
            bytes_per_second: source_rate * 8,
            block_alignment: 8,
            bits_per_sample: 32,
            extended_format: None,
        },
    )
    .map_err(|error| freeze_error("create track freeze", error))?;
    let mut output = writer
        .audio_frame_writer()
        .map_err(|error| freeze_error("start track freeze data", error))?;
    let inputs = vec![[0.0_f32; MAX_OUTPUT_CHANNELS]; MAX_PLUGIN_BLOCK_FRAMES];
    let mut outputs = vec![[0.0_f32; MAX_OUTPUT_CHANNELS]; MAX_PLUGIN_BLOCK_FRAMES];
    let mut interleaved = Vec::with_capacity(MAX_PLUGIN_BLOCK_FRAMES * 2);
    let mut rendered_source = 0_u64;
    while rendered_source < content_frames {
        if cancel.load(Ordering::Relaxed) {
            return Err(EngineError::State("track freeze cancelled".to_owned()));
        }
        let count =
            usize::try_from((content_frames - rendered_source).min(MAX_PLUGIN_BLOCK_FRAMES as u64))
                .unwrap_or(MAX_PLUGIN_BLOCK_FRAMES);
        runtime.render_block(&inputs[..count], &mut outputs[..count], None, None);
        write_block(&mut output, &outputs[..count], &mut interleaved)?;
        rendered_source += count as u64;
        progress(TrackFreezeProgress::Rendering {
            completed_frames: rendered_source,
            total_frames: content_frames.saturating_add(tail_limit),
        });
    }
    runtime.clips.clear();
    runtime.midi_events.clear();
    runtime.handle_command(EngineCommand::Transport(
        TransportAction::Pause,
        request.end_frame,
    ));
    runtime.handle_command(EngineCommand::Transport(
        TransportAction::Play,
        request.end_frame,
    ));
    let mut tail_rendered = 0_u64;
    let mut quiet_frames = 0_u64;
    while tail_rendered < tail_limit {
        if cancel.load(Ordering::Relaxed) {
            return Err(EngineError::State("track freeze cancelled".to_owned()));
        }
        let count =
            usize::try_from((tail_limit - tail_rendered).min(MAX_PLUGIN_BLOCK_FRAMES as u64))
                .unwrap_or(MAX_PLUGIN_BLOCK_FRAMES);
        runtime.render_block(&inputs[..count], &mut outputs[..count], None, None);
        let peak = outputs[..count].iter().fold(0.0_f32, |peak, frame| {
            peak.max(frame[0].abs()).max(frame[1].abs())
        });
        quiet_frames = if peak < TAIL_SILENCE_AMPLITUDE {
            quiet_frames.saturating_add(count as u64)
        } else {
            0
        };
        write_block(&mut output, &outputs[..count], &mut interleaved)?;
        tail_rendered += count as u64;
        progress(TrackFreezeProgress::Rendering {
            completed_frames: content_frames + tail_rendered,
            total_frames: content_frames + tail_limit,
        });
        if known_tail.is_none() && quiet_frames >= u64::from(source_rate) * 2 {
            break;
        }
    }
    output
        .end()
        .map_err(|error| freeze_error("finalize track freeze", error))?;
    let tail_truncated = known_tail.is_none() && tail_rendered >= maximum_tail;
    Ok(TrackFreezeResult {
        rendered_frames: content_frames.saturating_add(tail_rendered),
        content_frames,
        tail_frames: tail_rendered,
        latency_samples,
        tail_truncated,
        sample_rate: source_rate,
    })
}

fn write_block<W: std::io::Write + std::io::Seek>(
    output: &mut bwavfile::AudioFrameWriter<W>,
    frames: &[[f32; MAX_OUTPUT_CHANNELS]],
    interleaved: &mut Vec<f32>,
) -> EngineResult<()> {
    interleaved.clear();
    interleaved.extend(frames.iter().flat_map(|frame| [frame[0], frame[1]]));
    output
        .write_frames(interleaved)
        .map_err(|error| freeze_error("write track freeze", error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use heron_audio_plugin::{
        AudioPluginProcessor, ProcessContext, ProcessOutcome, SidechainSource,
    };
    use heron_dsp_runtime::protocol::{
        LiveLatencyPolicy, LiveMixerChannel, LivePluginInstance, PluginAudioMode,
    };
    use heron_dsp_runtime::tempo::{TempoEvent, TimeSignatureEvent};

    struct ImpulseProcessor {
        frame: u64,
    }

    impl AudioPluginProcessor for ImpulseProcessor {
        fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
            Box::new(Self { frame: self.frame })
        }

        fn process_block(
            &mut self,
            frames: &mut [[f32; 2]],
            _sidechains: &dyn SidechainSource,
            context: &ProcessContext,
        ) -> ProcessOutcome {
            let start = u64::try_from(context.project_time_samples).unwrap_or(0);
            for (offset, frame) in frames.iter_mut().enumerate() {
                *frame = if start.saturating_add(offset as u64) == self.frame {
                    [1.0, 1.0]
                } else {
                    [0.0, 0.0]
                };
            }
            ProcessOutcome::Processed
        }
    }

    struct DelayProcessor {
        delay: usize,
        buffer: Vec<[f32; 2]>,
        cursor: usize,
    }

    impl DelayProcessor {
        fn new(delay: usize) -> Self {
            Self {
                delay,
                buffer: vec![[0.0, 0.0]; delay.max(1)],
                cursor: 0,
            }
        }
    }

    impl AudioPluginProcessor for DelayProcessor {
        fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
            Box::new(Self {
                delay: self.delay,
                buffer: self.buffer.clone(),
                cursor: self.cursor,
            })
        }

        fn process_block(
            &mut self,
            frames: &mut [[f32; 2]],
            _sidechains: &dyn SidechainSource,
            _context: &ProcessContext,
        ) -> ProcessOutcome {
            if self.delay == 0 {
                return ProcessOutcome::Processed;
            }
            for frame in frames.iter_mut() {
                let delayed = self.buffer[self.cursor];
                self.buffer[self.cursor] = *frame;
                self.cursor = (self.cursor + 1) % self.delay;
                *frame = delayed;
            }
            ProcessOutcome::Processed
        }
    }

    fn channel(id: &str, kind: &str) -> LiveMixerChannel {
        LiveMixerChannel {
            id: id.to_owned(),
            name: id.to_owned(),
            color: "#000000".to_owned(),
            kind: kind.to_owned(),
            system_role: None,
            gain_db: -6.0,
            pan: -1.0,
            muted: false,
            soloed: false,
            output_channel_id: if kind == "instrument" {
                Some("output".to_owned())
            } else {
                None
            },
            output_bus: None,
            output_format: None,
            record_armed: false,
            input_monitoring: false,
            midi_input_port_id: None,
            midi_input_port_name: None,
            midi_input_channel: None,
            input_source: None,
            input_channels: Vec::new(),
            application_capture: None,
            hardware_output_channels: if kind == "output" {
                vec![1, 2]
            } else {
                Vec::new()
            },
        }
    }

    fn plugin(id: &str, role: &str, latency: u32, tail: u32) -> LivePluginInstance {
        LivePluginInstance {
            instance_id: id.to_owned(),
            instance_generation: 1,
            channel_id: "instrument".to_owned(),
            role: role.to_owned(),
            slot_order: if role == "instrument" { 0 } else { 1 },
            audio_mode: PluginAudioMode::Stereo,
            duplicate_mono_output: false,
            enabled: true,
            aux_input_buses: Vec::new(),
            latency_samples: latency,
            tail_samples: Some(tail),
        }
    }

    fn request(mode: TrackFreezeMode, path: PathBuf) -> TrackFreezeRequest {
        let mut slots = HashMap::new();
        slots.insert(
            "instrument".to_owned(),
            AudioPluginProcessorHandle::new(ImpulseProcessor { frame: 255 }),
        );
        slots.insert(
            "insert".to_owned(),
            AudioPluginProcessorHandle::new(DelayProcessor::new(32)),
        );
        TrackFreezeRequest {
            graph: LiveMixerGraph {
                sample_rate: 48_000,
                project_end_tick: 61_440,
                latency_policy: LiveLatencyPolicy::Normal,
                channels: vec![
                    channel("instrument", "instrument"),
                    channel("master", "master"),
                    channel("output", "output"),
                ],
                sends: Vec::new(),
                clips: Vec::new(),
                plugins: vec![
                    plugin("instrument", "instrument", 0, 0),
                    plugin("insert", "insert", 32, 64),
                ],
                midi_clips: Vec::new(),
                tempo_events: vec![TempoEvent {
                    tick: 0,
                    beats_per_minute: 120.0,
                }],
                time_signature_events: vec![TimeSignatureEvent {
                    tick: 0,
                    numerator: 4,
                    denominator: 4,
                }],
            },
            revision: 1,
            plugin_slots: slots,
            channel_id: "instrument".to_owned(),
            mode,
            start_frame: 0,
            end_frame: 256,
            output_path: path,
        }
    }

    fn read_left(path: &PathBuf) -> Vec<f32> {
        let mut reader = bwavfile::WaveReader::open(path).expect("open freeze file");
        let frames = reader.frame_length().expect("freeze length") as usize;
        let mut samples = vec![0.0_f32; frames * 2];
        let read = reader
            .audio_frame_reader()
            .expect("freeze reader")
            .read_frames(&mut samples)
            .expect("read freeze samples") as usize;
        samples.truncate(read * 2);
        samples.into_iter().step_by(2).collect()
    }

    #[test]
    fn pre_fader_keeps_plugin_delay_inside_the_tail() {
        let path = std::env::temp_dir().join(format!(
            "heron-freeze-pre-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let result = render_track_freeze(
            request(TrackFreezeMode::PreFader, path.clone()),
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("pre-fader freeze");
        let left = read_left(&path);
        assert_eq!(result.latency_samples, 32);
        assert!(result.tail_frames >= 64);
        assert!(!result.tail_truncated);
        assert!(
            left[255].abs() < 1.0e-4,
            "impulse must not stay at the source frame"
        );
        assert!(
            (left[287] - 1.0).abs() < 1.0e-4,
            "impulse follows the plug-in delay once"
        );
        assert!(
            left[255 + 64].abs() < 1.0e-4,
            "delay must not be compensated twice"
        );
        std::fs::remove_file(path).expect("remove freeze file");
    }

    #[test]
    fn source_only_omits_insert_delay() {
        let path = std::env::temp_dir().join(format!(
            "heron-freeze-source-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let result = render_track_freeze(
            request(TrackFreezeMode::SourceOnly, path.clone()),
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("source-only freeze");
        let left = read_left(&path);
        assert_eq!(result.latency_samples, 0);
        assert!((left[255] - 1.0).abs() < 1.0e-4);
        assert!(left.get(287).copied().unwrap_or(0.0).abs() < 1.0e-4);
        std::fs::remove_file(path).expect("remove freeze file");
    }
}
