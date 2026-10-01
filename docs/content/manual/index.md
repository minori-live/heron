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

The welcome screen can create a Live document. At Project level, you can add
Audio, Instrument, Aux, and Output Channels, edit routing and Sends, and store a
device/MIDI selection. Create Sets and Patches in the left panel to prepare Mixer
variations, then save and reopen the `.hrl` file. Edit mode is silent; storing a
device selection does not start audio.

Live keeps the Studio topbar and bottom statusbar. The document panel is on the
left, the Mixer is on the right, and the center remains empty for future custom
performance layouts. Use the Mixer channel strips to rename channels and edit
their routing, Sends, pan, and gain. Open **Audio & MIDI devices** to edit the
document's device selection. The Mixer edge supports dragging or arrow keys to
resize; double-clicking it restores the default width.
Select **Project**, a Set, or a Patch in the left panel to choose what you are
editing. A Set groups Patches and supplies shared values. The Mixer combines the
Project values with the selected Set and Patch overrides. Selecting a Patch does
not start audio.

The left panel shows where the selected channel's Gain, Pan, Mute and Solo values
are defined. Ordinary Mixer adjustments edit that defining layer and also affect
its descendants that inherit the field. Use **Override here** to keep a separate
value at the selected Set or Patch, then adjust it in the Mixer. **Revert** restores
inheritance. The override dialog also lists Sends, plug-in enablement, complete
plug-in state and stored parameter values. A complete state override keeps a
separate copy of the plug-in's saved state; saved parameter overrides still apply
after that state is restored. Structural changes, including adding channels or
changing routing and plug-in chains, require selecting **Project**.

Sets and Patches can be renamed or copied. Copy keeps their explicit overrides;
a Patch copy inherits from its destination Set. Deleting a Set also deletes its
Patches, and the confirmation lists the number of affected layers and overrides.
These changes support Undo and Redo. A root channel, Send or plug-in with dependent
overrides must have those overrides reverted before it can be deleted or replaced.

Choose **Perform** to activate Project using the document's audio devices. Use
**Activate** on Project or a Patch to change the sounding layer; Sets supply
shared values and cannot be activated. The active layer is marked in the left
panel. Patch changes prepare new plug-in instances before switching audio. If
preparation fails, the previous layer remains active.

During Perform, Mixer Gain, Pan, Mute, Solo, Send level and enablement, and plug-in
enablement are temporary. Structure, routing and device settings are locked.
**Save** writes the existing document values. Use **Capture** to review a frozen
list of changes and select which values to keep. Each selected scalar updates
its defining Project, Set or Patch layer. For complete plug-in state, review the
destination: update its defining layer or create a separate override in the active
Patch. Updating Project or Set also affects descendants inheriting that state.
Complete state includes embedded parameter values even when separate parameter
fields are unchecked; existing saved parameter overrides still apply afterward.
Plug-in editor integration and Live document MIDI control bindings remain under
development.

Leaving Perform, changing Patch or closing the document offers a decision about
uncaptured changes. Choose Capture to review and save selected changes, then
retry the transition; discard continues without keeping them, and cancel keeps
the performance running. Returning to Edit stops Live audio.

If an edit's result cannot be confirmed, use **Check change result** before making more
changes. If the document needs recovery, **Close and recover** keeps both the
saved file and its working copy. Reopen the file to choose which copy to use.

Opening an older root-only or scalar-layer Live file upgrades the working copy; saving writes the
new format, which older Heron versions cannot open.

Use the application **File** menu to open, save, or close documents. Save also
uses **Ctrl+S** on Windows/Linux or **Command+S** on macOS, as in Studio.

## A note on this manual

The manual describes the current development version. Labels may move as the
interface evolves. Each page has an **Improve this page** link if you find an
instruction that no longer matches the application.
