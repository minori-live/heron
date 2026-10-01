//! A bounded sequential fade for Live graph replacement; no parallel tails or callback allocation.
use super::super::{HardwareOutputFrame, HeapProd, InputFrame, MixerRuntime, RecordingTap};
use ringbuf::traits::Producer;

#[derive(Default)]
pub(super) struct LiveCut {
    outgoing: Option<Box<MixerRuntime>>,
    frames: u32,
    out_remaining: u32,
    in_remaining: u32,
    retired: bool,
}

impl LiveCut {
    pub(super) fn active(&self) -> bool {
        self.outgoing.is_some() || self.in_remaining > 0
    }

    pub(super) fn begin(&mut self, outgoing: Option<Box<MixerRuntime>>, frames: u32) {
        self.out_remaining = if outgoing.is_some() { frames } else { 0 };
        self.in_remaining = frames;
        self.frames = frames;
        self.outgoing = outgoing;
        self.retired = false;
    }

    pub(super) fn render(
        &mut self,
        runtime: &mut MixerRuntime,
        inputs: &[InputFrame],
        outputs: &mut [HardwareOutputFrame],
        midi: &mut crate::midi_input::RealtimeMidiConsumer,
        recording: &mut RecordingTap,
        retired: &mut HeapProd<Box<MixerRuntime>>,
    ) -> bool {
        let mut underrun = false;
        let count = (self.out_remaining as usize).min(outputs.len());
        if let Some(outgoing) = self.outgoing.as_mut() {
            // All Notes Off and sustain release were queued before this last processing window.
            // New physical MIDI is consumed by the incoming graph after the cut.
            if count > 0 {
                underrun |=
                    outgoing.render_block(&inputs[..count], &mut outputs[..count], None, None);
            }
            for frame in &mut outputs[..count] {
                self.out_remaining = self.out_remaining.saturating_sub(1);
                let gain = self.out_remaining as f32 / self.frames.max(1) as f32;
                for sample in frame {
                    *sample *= gain;
                }
            }
            if self.out_remaining == 0
                && let Some(mut outgoing) = self.outgoing.take()
            {
                if !self.retired {
                    outgoing.retire_plugin_processors();
                    self.retired = true;
                }
                if let Err(outgoing) = retired.try_push(outgoing) {
                    self.outgoing = Some(outgoing);
                }
            }
        }
        if count < outputs.len() {
            underrun |= runtime.render_block(
                &inputs[count..],
                &mut outputs[count..],
                Some(midi),
                Some(recording),
            );
            for frame in &mut outputs[count..] {
                if self.in_remaining == 0 {
                    break;
                }
                let gain = (self.frames - self.in_remaining) as f32 / self.frames.max(1) as f32;
                self.in_remaining -= 1;
                for sample in frame {
                    *sample *= gain;
                }
            }
        }
        underrun
    }
}
