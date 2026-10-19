---
title: Heron Repitch
description: Pitch-shift audio with Heron Repitch, a Rubber Band LiveShifter effect with dry/wet mix.
vstTrademark: true
---

# Heron Repitch

Heron Repitch is a realtime pitch shifter based on Rubber Band LiveShifter.
Its editor follows the same kind of layout as Heron Revox: semitone and cent
controls, formant preservation, a quality choice, and a dry/wet mix.

Heron Studio includes Heron Repitch, so it can be loaded there without a
separate plug-in installation. For another DAW, install it from the
[plug-in releases](../releases.md).

## Get started

1. In another DAW, [install the Heron plug-ins](../releases.md) for your
   operating system and the format that DAW supports. In Heron Studio, the
   effect is already bundled.
2. Restart the DAW and rescan its plug-in catalog if needed.
3. Add **Heron Repitch** as an audio effect and open its editor.

Supported layouts are mono and stereo.

## Controls

| Control   | Range           | What it does                                                                      |
| --------- | --------------- | --------------------------------------------------------------------------------- |
| Semitones | −12 to +12      | Coarse pitch shift, in semitones. Default is 0.                                   |
| Cents     | −100 to +100    | Fine pitch shift, added to Semitones. Default is 0.                               |
| Formant   | On or off       | Preserves formants while the pitch changes. On by default.                        |
| Quality   | Faster or Finer | Window trade-off inside the live shifter. Finer is the default.                   |
| Mix       | 0% to 100%      | Dry/wet mix. 0% is latency-aligned dry audio; 100% is fully wet. Default is 100%. |

## Latency

Heron compensates the latency the plug-in reports. Repitch reports Rubber Band
LiveShifter's start delay (`getStartDelay()`) for the active quality and pitch.
That reported value can change when Semitones, Cents, or Quality change. Heron
does not replace it with a separate formula.

## Related pages

- [Plugin releases](../releases.md)
- [Plug-in manual overview](index.md)
- [VST 3 plug-ins in Heron Studio](../../manual/plugins.md)
