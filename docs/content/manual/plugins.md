---
title: VST® 3 plug-ins
description: Discover, add, configure, and troubleshoot VST 3 instruments and effects.
vstTrademark: true
---

# VST® 3 plug-ins

Heron discovers VST 3 instruments and effects from standard system and user
locations. Plug-ins run inside the embedded native audio runtime owned by the
application. Load failures are reported to the interface, while fatal native
plug-in faults terminate the application instead of leaving a disconnected UI
and audio process behind.

Audio Unit, CLAP, VST 2, and AAX plug-ins are not currently scanned. See
[Supported backends and plug-in formats](supported-backends.md) for the full
platform matrix and planned formats.

## Scan the catalog

Heron scans on startup. To look again after installing a plug-in:

1. open **Library**;
2. choose the plug-in catalog;
3. select **Rescan VST3**.

The startup and scan views report discovered bundles, available plug-ins, and
modules that could not be loaded.

Before first loading a plug-in, Heron checks its supported channel layouts. If
a package contains several plug-ins, this check applies to the one you selected.

## Add an instrument

Add an instrument channel, then select its **Instrument** input slot. Search by
name or vendor and choose the plug-in.

If the instrument supports more than one layout, choose its audio mode before
loading it. Instrument modes include mono and stereo output.

## Add an effect

On any compatible mixer channel:

1. select an empty slot under **Audio FX**;
2. search the VST 3 effect catalog;
3. choose a supported mode;
4. select the loaded insert to open its editor.

Effects may support mono, stereo, mono-to-stereo, or dual-mono layouts. An
unsupported mode remains unavailable in the picker.

## Heron EQ

**Heron EQ** is a bundled effect with up to 24 bands. Add it through an
**Audio FX** slot, then open its native editor.

The graph is the main editing surface. Selecting a band shows compact controls
at the lower center; they stay in place while frequency or gain changes.
Clicking empty graph space deselects the band and hides the controls. Common
actions use icons; hover over one to read its tooltip. The top bar contains the
**⋯** tools menu. Processing mode keeps its current name in the bottom bar;
the analyzer uses spectrum bars, and output uses a
speaker beside its percentage/dB readout. Active icons are highlighted and
unavailable actions are dimmed.

- Double-click the graph to add a band; drag its node to change frequency and
  gain, and use the wheel over a node to change Q. Right-click a node to open
  its action menu, including deletion, duplication and copying. Shift-click
  selects a group; dragging empty space selects a rectangle.
- The selected-band controls provide frequency, gain and Q knobs. Double-click
  a knob or click its value to enter an exact number. Shape and
  **Stereo**, **Left**, **Right**, **Mid** or **Side** processing are available
  in the same panel. Roll-off in dB/oct appears for Low Cut, High Cut and Band
  Pass. The power icon bypasses or enables the selected bands; the headphones
  icon (**Solo focused band**) auditions one band, and the trash icon deletes
  the selection.
- Open the bottom-bar spectrum icon for **Analyzer**. **Pre** and **Post** display measured input and
  output spectra as smooth curves. Pre is a thin gray line and Post a light
  filled trace. Read spectrum level from the right dBFS axis and EQ gain from
  the left dB axis. **External**
  displays this plug-in's routed sidechain. The editor shows only the current
  instance's spectra. The snowflake
  (**Freeze spectrum**) keeps a captured spectrum on screen. The keyboard icon
  (**Piano / frequency snap**) in **⋯** snaps frequency gestures to musical notes.
- The band options menu's copy and clipboard icons transfer bands between instances.
  Pasting keeps the destination's output/mode settings and requires enough free
  slots for every copied band.
- In Analyzer, the chain-link icon (**Fit EQ to sidechain spectrum**) fits EQ to
  this instance's sidechain spectrum.
  Route the reference audio to this plug-in's sidechain first.

Heron saves and restores EQ settings with the project. Undo/redo, preset management
and comparison belong to the host; the EQ editor has no local history, drawing
tool, A/B or preset panel. Its bands use static filters.
To use a result from [EQ Fit](plugin-analysis.md#fit-a-parametric-eq), copy its
complete JSON, add a new empty **Zero latency** instance, then open the top-bar
**⋯** menu and choose the clipboard icon (**Paste bands**). This adds the fitted bands while keeping
the destination's processing mode and output settings. Set the output gain
separately to the fit's **Overall Gain**. If the fit has no bands, skip pasting
and set only the output gain. This band transfer does not import a whole preset.

Click the bottom-right speaker/readout for gain, automatic gain, gain scale, polarity and Left/Right or
Mid/Side pan. Pan is neutral in true mono
mode. The input/output
meters and peak readouts use actual audio samples. The crossed-out speaker (**Mute output**) fades output to true
silence; global bypass restores the latency-compensated dry signal.
The opposing level arrows (**Enable auto gain**) toggle automatic gain; the
plus/minus arrow (**Invert output polarity**) toggles polarity inversion.

The processing modes use Heron's algorithms: **Zero latency** uses digital
filters, **Natural phase** uses oversampled filtering, and **Linear phase** uses
a symmetric FIR with selectable resolution. The host compensates the reported
latency. The editor reports preparation failures while the previous processor
remains active.

The dB/oct control describes a cut or band-pass filter's roll-off. Bell and shelf
bands use frequency, gain and Q, and do not display a dB/oct value. Fitted bands
use one RBJ filter section per band; the original frequency, gain and Q are
retained. Frequency, Q and mode values are specific to Heron's algorithms;
matching another equalizer's numbers alone does not guarantee the same response.

## Manage inserts

An insert can be:

- opened in its native editor;
- bypassed and enabled again;
- moved to another slot;
- removed;
- switched to another supported audio mode.

Changing or removing a plug-in is part of project history where the operation
supports undo.

## Route a side-chain input

When a VST3 instrument or effect exposes a mono or stereo auxiliary audio input,
its native editor toolbar shows **Side-chain**. Open it, choose the auxiliary
input bus, then select **Audio**, **Instrument**, or **Aux** and a source
channel. Choose **None** to disconnect that bus. Each auxiliary input is routed
independently.

The source is the channel's post-pan signal: its plug-in chain, fader, mute,
solo, and pan all affect the side-chain. Hardware inputs and internal BUS slots
cannot be selected directly. Master, Output, the plug-in's own channel, and any
source that would create feedback are excluded.

The old selection remains active while the project change is pending. A failed
change leaves it untouched and displays a warning. If the project was saved but
the audio graph could not be deployed completely, the new selection remains
the project value and the editor reports the degraded audio state.

## Missing or failed plug-ins

Use [Plugin Analysis](plugin-analysis.md) to measure an independent effect chain's
response, harmonics, Hammerstein approximation and performance.

The project keeps a legal signal path when a stored plug-in is missing,
quarantined, or fails to start. Check the slot state and catalog status, then:

1. confirm that the correct plug-in and architecture are installed;
2. rescan the catalog;
3. restart Heron if the plug-in was installed while the host was active;
4. bypass or remove a plug-in that repeatedly fails.

Never assume two plug-ins with similar names or vendors are interchangeable;
their identifiers and saved state may differ.
