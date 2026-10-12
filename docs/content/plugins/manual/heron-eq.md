---
title: Heron EQ
description: Learn to edit bands, use the analyzer and sidechain matching, and manage Heron EQ in your DAW.
vstTrademark: true
---

# Heron EQ

Heron EQ is a parametric equalizer with up to 24 bands. This chapter covers its
editor in a compatible VST® 3 or Audio Unit host. For downloads and installation,
see [Plugin releases](../releases.md); for a feature overview, see
[Heron EQ](../heron-eq.md).

![Heron EQ with three bands, a spectrum display, and selected-band controls](/plugins/heron-eq.png)

## Quick start

1. Add **Heron EQ** as an audio effect in your DAW and open its editor.
2. Play audio through the plug-in. Open **Analyzer** from the spectrum-bars
   icon in the bottom bar and enable **Pre** and **Post** to see the input and
   output spectra.
3. Double-click the graph to add a band. Drag its node horizontally to change
   frequency and vertically to change gain. Scroll over the node to adjust Q.
4. Select the band to choose its filter shape or enter exact values.
5. Adjust the output from the speaker/readout in the bottom-right corner, then
   save your DAW session to keep the settings.

## Find your way around the editor

The frequency graph is the main editing area. Frequency runs from left to right;
the left axis shows EQ gain in dB, and the right axis shows spectrum level in dBFS.
The EQ response curve shows your settings, while the moving spectrum traces
show measured audio.

Selecting a band opens its controls at the lower center of the graph. The panel
stays in place as you move a node. Click empty graph space to deselect the bands
and hide their controls.

The top-bar **⋯** menu opens **Display & tools**. The bottom bar provides global
bypass, processing mode, Analyzer, and output controls. Hover over icons to read
their tooltips. Active controls are highlighted; unavailable actions are dimmed.
Use a panel's close button when you have finished adjusting it.

## Add and edit bands

| Action                    | How to do it                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| Add a band                | Double-click empty graph space.                                           |
| Adjust frequency and gain | Drag the band's node.                                                     |
| Adjust Q                  | Scroll over the node, or use the Q control.                               |
| Enter an exact value      | Double-click a knob or click its readout, type a value, then press Enter. |
| Select several bands      | Shift-click nodes, or drag a selection rectangle from empty graph space.  |
| Move a group              | Drag a selected node with several bands selected.                         |
| Open band options         | Right-click a node, or use the selected-band **⋯** button.                |
| Duplicate bands           | Choose **Duplicate** in the band options.                                 |
| Delete bands              | Click the trash icon to delete the selection.                             |

The **Frequency**, **Gain**, and **Q** controls belong to the selected band.
Q sets how narrow or broad the affected frequency region is. The power icon in
the band controls bypasses or enables the selected bands without deleting them.
The headphones icon, **Solo focused band**, auditions one band; click it again
to leave solo.

An instance can contain at most 24 bands, including bypassed bands. Delete bands
you no longer need before adding or duplicating more.

### Choose a filter shape

Use the shape menu in the selected-band controls.

| Shape                      | What it does                                                        |
| -------------------------- | ------------------------------------------------------------------- |
| **Bell**                   | Boosts or cuts a region around the selected frequency.              |
| **Low shelf / High shelf** | Boosts or cuts the low or high end.                                 |
| **Low cut / High cut**     | Removes frequencies below or above the selected cutoff.             |
| **Notch**                  | Cuts a narrow frequency region.                                     |
| **Band pass**              | Keeps a frequency region while reducing frequencies on either side. |
| **Tilt shelf / Flat tilt** | Changes the balance between lower and higher frequencies.           |
| **All pass**               | Changes phase without an intended change in level.                  |

**Low cut**, **High cut**, and **Band pass** provide a slope in **dB/oct**.
A steeper slope gives a stronger roll-off. Other shapes do not display this
control. The bands apply the settings you choose; they do not automatically
change gain in response to incoming level.

## Choose which channels a band affects

Use the channel menu beside the shape controls.

| Channel          | Affected signal                                      |
| ---------------- | ---------------------------------------------------- |
| **Stereo**       | Both left and right channels.                        |
| **Left / Right** | Only the selected channel.                           |
| **Mid**          | The component shared by the left and right channels. |
| **Side**         | The difference between the left and right channels.  |

The band options include **Split L/R** and **Split M/S**. These turn selected
stereo bands into separate Left/Right or Mid/Side bands so you can adjust each
independently. Splitting requires room within the 24-band limit.

In **Display & tools**, **Display channel** changes the channel shown by the
graph. It does not change a band's processing channel. **Display range** changes
the graph's visible EQ-gain range.

## Use the analyzer

Click the spectrum-bars icon in the bottom bar to open **Analyzer**.

- **Pre** displays the input spectrum as a thin gray line.
- **Post** displays the output spectrum as a light filled trace.
- **External** displays the signal routed to this instance's sidechain input.

**Resolution** adjusts frequency detail, **Speed** adjusts how quickly the
display follows changes, and **Range** changes its visible level range.
**Tilt** changes the spectrum's display slope. These display settings do not
change the sound. Display tilt and channel selection do not change the raw
measurements used for sidechain matching.

### Freeze a spectrum

Click the snowflake, **Freeze spectrum**, to hold the current capture. Click it
again to return to live measurements. Freezing the display does not pause audio
or stop EQ processing.

### Snap frequencies to notes

Open the top-bar **⋯** menu and enable the keyboard icon,
**Piano / frequency snap**. Frequency gestures then snap to musical notes.
Click it again to return to free frequency adjustment.

### Match a sidechain reference

1. In your DAW, route the reference audio to this Heron EQ instance's sidechain
   input. The routing controls belong to the host.
2. Play audio through both the main input and the sidechain. Enable **External**
   in Analyzer to check that the reference reaches the plug-in.
3. Click the chain-link icon, **Fit EQ to sidechain spectrum**, in Analyzer.
4. Listen to the result and adjust the bands or output as needed.

Matching uses the measured main input and sidechain to create a new EQ setting.
A successful match replaces the current bands, processing mode, and output
settings. Save the current setting in your host first if you want to keep it.
If the spectrum is frozen, matching uses that capture; unfreeze it to use fresh
measurements.

The result is a static EQ setting, so it does not keep following later changes
in the reference. If there is insufficient audio to match, play material with
energy across a wider frequency range and try again. A failed match leaves the
current settings intact. Close the result notice or press Escape to dismiss it.

## Copy and paste bands

1. Select the bands you want to transfer.
2. Open the band options and choose **Copy**.
3. Open the destination Heron EQ instance.
4. Open its top-bar **⋯** menu and choose **Paste bands**, or use **Paste** in
   its band options.

Paste appends the copied bands. It keeps the destination's existing bands,
processing mode, and output settings. There must be enough free slots for all
copied bands; if the paste cannot be applied, the destination stays unchanged.
Band copy/paste transfers bands, not a complete plug-in preset.

When the editor has keyboard focus, **Ctrl+C / Ctrl+V / Ctrl+D** on Windows and
Linux, or **Command+C / Command+V / Command+D** on macOS, copy, paste, and duplicate
bands. **Delete** or **Backspace** removes the selection.

## Adjust the output

Click the speaker/readout in the bottom-right corner to open **Output**.

- **Output · dB** sets output gain.
- **Gain scale** adjusts the strength of the bands' gain changes together.
- **Enable auto gain**, the opposing level arrows, toggles automatic gain
  compensation to help reduce the level change caused by EQ.
- **Pan** adjusts Left/Right or Mid/Side balance according to the selected mode.
  It stays neutral in a true mono instance.
- **Invert output polarity**, the plus/minus arrow, reverses output polarity.
- **Mute output**, the crossed-out speaker, silences the output. Click it again
  to unmute.

The input/output meters and peak readouts show measured audio levels. The
bottom-bar global bypass returns the dry signal with latency compensation,
allowing comparison with the processed signal.

## Choose a processing mode

Click the current mode name in the bottom bar.

| Mode              | Use and controls                                                                       |
| ----------------- | -------------------------------------------------------------------------------------- |
| **Zero latency**  | EQ without added processing latency, useful when monitoring or playing live.           |
| **Natural phase** | An alternative phase response with added processing latency.                           |
| **Linear phase**  | Linear-phase EQ with a selectable **Resolution**. Higher resolutions add more latency. |

Natural phase and Linear phase report their latency to the host for delay
compensation. The Linear phase resolution menu provides **Low**, **Medium**,
**High**, **Very high**, and **Maximum**.

When a change needs preparation, the current processing continues while the
editor shows its status. If preparation fails, the previous working settings
remain active. Check the processing panel's status before judging the result.

## Use MIDI controls

Route MIDI controller messages to the plug-in in your host. Select a band, open
its band options, and choose **MIDI** to open **MIDI learn**. Choose a control
from the list, then move the MIDI CC knob or slider you want to assign.

**Clear band bindings** removes the focused band's assignments.
**Clear global bindings** removes assignments for shared controls such as
output. The assignments are stored with the plug-in state.

## Save and restore settings

Save your DAW session to store the plug-in settings. Use your host's plug-in
preset controls to reuse complete settings in other sessions, and its undo/redo
and comparison controls where available.

The editor's band clipboard is for transferring bands. To recall the whole
setup, including processing mode and output settings, use the host's saved
plug-in state or preset.
