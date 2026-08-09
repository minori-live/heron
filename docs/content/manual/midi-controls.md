---
title: MIDI Controls
description: Map hardware controls to commands, Mixer controls, and plug-in parameters.
---

# MIDI Controls

Open **Settings → MIDI → MIDI Controls** to create global hardware mappings.
Mappings remain available across projects and after a controller disconnects.
Heron reconnects them when the same device ID returns.

## Learn a control

1. Choose **Learn / Add mapping**.
2. Move a knob, encoder, pad, or key. The first valid event fills the device,
   zero-based channel, message type, and number in the draft.
3. Choose the input mode and target, then choose **Save mapping**.

Learning pauses existing mappings. The monitor continues to show raw values;
for relative encoders it also shows the decoded delta, event rate, and normalized
delta. Canceling or leaving the page ends learning.

Saving a new mapping never removes mappings already using that address. A group
with several targets shows an informational fan-out notice. Each target is
best-effort: a missing plug-in does not stop a command or Mixer target, and the
message still reaches instruments and recording.

## Input modes

- **Absolute** maps CC values 0–127 through an absolute transform profile.
- **Relative** requires an explicit 1/127, two's-complement, or binary-offset
  decoder. Heron does not guess encoder format.
- **Note** supports application commands and Mute/Solo toggles.

Commands and CC toggles fire on the transition from below 64 to 64 or above.
Absolute Mute/Solo uses zero for off and any non-zero value for on.

## Targets

Ordered Mixer targets use **Audio → Instrument → BUS → Master → Output**, then
the visible order within each category. Metronome and system channels are not
included. Reordering intentionally changes what an index controls.

Plug-in mappings use a project-unique control alias and stable parameter key.
Set the alias in the same settings page before creating a mapping. Moving a
plug-in keeps its alias; deleting it leaves the global mapping unresolved. Only
visible, writable, automatable parameters can be selected.

## Transform profiles

Gain defaults to the DAW fader profile; Pan and plug-ins default to Linear.
Built-in profiles are read-only. Select an absolute profile to duplicate it,
then edit its segments in the visual curve and keyboard-accessible table. The
preview samples all 128 CC values. Save replaces the profile for every binding
that references it; Cancel discards the draft.

Relative profiles combine a base step with event-rate acceleration. The supplied
Normal profile has no acceleration and Fine makes smaller changes.

## Saving and Undo

Hardware adjustments mark the project dirty but do not create Undo entries.
An explicit mouse edit wins for the same Mixer field. Saving commits pending
Mixer adjustments and captured plug-in state together; a failed save leaves the
adjustments available to retry. Choosing not to save discards them. Unsaved
hardware adjustments are not guaranteed to recover after a crash.

Current does not include soft takeover, Mackie Control/HUI, hardware feedback,
controller displays, or Send targets.
