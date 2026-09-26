---
title: Welcome to Heron
description: Learn what Heron can do and find your way through the user manual.
vstTrademark: true
---

# Welcome to Heron

Heron is a free, open-source digital audio workstation for Windows, macOS, and
Linux. It brings audio recording, MIDI arrangement, VST® 3 instruments and
effects, routing, and mixing into one desktop workspace.

::: warning Experimental software
Heron is under active development and is not yet recommended for production
sessions or live performances. Keep separate backups of important recordings
and projects. Project compatibility may change before version 1.0.
:::

## Choose where to begin

- **New to Heron?** [Install the application](install.md), then
  [make your first project](first-project.md).
- **Ready to record?** Set up an input and follow the
  [audio recording guide](recording.md).
- **Working with notes?** Learn about [MIDI clips and the piano roll](midi-and-piano-roll.md).
- **Building a mix?** Start with [the mixer and routing](mixer-and-routing.md).
- **Checking hardware or plug-in compatibility?** See
  [supported backends and plug-in formats](supported-backends.md).
- **Something is silent or unstable?** Work through [troubleshooting](troubleshooting.md).

## What is available today

The current foundation includes:

- self-contained Studio `.hrs` and `.heron` archives, independent Live `.hrl`
  archives, and recovery of unsaved working copies;
- a native real-time audio engine with configurable devices and buffer sizes;
- audio and instrument tracks on a musical timeline;
- audio recording with recoverable swap files;
- Standard MIDI File import, MIDI clips, and piano-roll editing;
- mixer channels, aux buses, sends, hardware outputs, metering, mute, and solo;
- VST 3 instrument and effect discovery, hosting, and plug-in editors;
- English and Simplified Chinese interfaces, with dark, light, and system themes.

Features shown as **Soon** in the application are placeholders, not completed
controls. Follow the [public roadmap](https://github.com/minori-live/heron/blob/main/agents/docs/roadmap.md)
for planned work.

The welcome screen can create a Live document for root Mixer editing. You can
add Audio, Instrument, Aux, and Output Channels, edit Sends and basic Mixer values,
store a device/MIDI selection, save, and reopen the `.hrl` file. Live Perform,
plug-in audition, and Capture are still under development; storing a device
selection does not start audio.

Live keeps the Studio topbar and bottom statusbar. The document panel is on the
left, the Mixer is on the right, and the center remains empty for future custom
performance layouts. Use the Mixer channel strips to rename channels and edit
their routing, Sends, pan, and gain. Open **Audio & MIDI devices** to edit the
document's device selection. The Mixer edge supports dragging or arrow keys to
resize; double-clicking it restores the default width.
Use the application **File** menu to open, save, or close documents. Save also
uses **Ctrl+S** on Windows/Linux or **Command+S** on macOS, as in Studio.

## A note on this manual

The manual describes the current development version. Labels may move as the
interface evolves. Each page has an **Improve this page** link if you find an
instruction that no longer matches the application.
