---
title: Plugin Analysis
description: Measure an independent effect chain's response, distortion, model and performance.
---

# Plugin Analysis

Choose **Help → Plugin Analysis…** to open an independent analysis window. You do
not need a project. Add effects using the Mixer plug-in picker and slots, then
open their native or parameter editors. The silent experiment chain does not
change your project.

The left side uses the same Audio FX slots as the Mixer. Click the first empty
slot to select a vendor, effect and audio mode. **Rescan** refreshes both bundled
and external effects. Unavailable effects show their load/probe reason; they
are not silently omitted from the directory.

## Set the measurement conditions

Open **Measurement settings** at the top right to set sample rate, block size,
frequency range, sweep duration and settle/tail
duration. Defaults are a 1 s sweep and 0.25 s settle/tail.
The **Sweep input level** slider accepts **−60 to +12 dBFS peak**. At 0 dBFS,
the peak amplitude is 1.0; +6 dBFS is approximately 2.0. Heron preserves these
floating point values to test limiters above full scale, without input clipping
or normalization.

Choose **Analyze**. **Auto analyze** starts after an effect is added, removed,
reordered or bypassed. Parameter, preset and measurement changes are analyzed after editing stops; the input-level slider commits when released. Continue editing while
it runs; superseded reports are marked as describing the previous state.
**Cancel** stops pending work and requests cancellation between processing
blocks. A plug-in call in progress must return before cancellation completes.

## Read the report

- **Linear:** frequency response, phase and IR. Select L→L, L→R, R→L or R→R.
  Use the controls below the main graph to switch Magnitude, Phase or IR;
  **L + R** overlays the two direct paths. **Store** retains a reference curve
  until **Clear** or a response-view change. Phase uses at least a ±3° range
  so small numerical errors do not dominate the display.
  Compensate measured delay to compare phase.
- **Harmonics:** H2–H8 in dBc and summed THD, measured with stable sine signals.
  **2D sweep spectrum** plots the actual output against time and frequency,
  with color representing peak spectral dBFS. Select L/R, linear/log sweep,
  and color-range limits. Each sweep is measured independently. Harmonic and
  reflected aliasing lines can be seen across the whole output spectrum.
  **Harmonics 1D** overlays H2–H8 versus input frequency; frequency supports
  linear/log axes and magnitude supports percent of fundamental/dBc. **THD**
  shows the summed distortion. Display changes use the retained report.
  Orders beyond Nyquist are omitted rather than counted as zero.
- **Hammerstein:** static nonlinearity followed by a linear FIR filter. Compare
  model predictions against an independent measured validation signal. Poor
  fits highlight the error readout. Compression, modulation
  and long tails often need more complex models.
- **Performance:** average/P95/P99/maximum processing time, deadline budget use,
  reported latency and memory estimates. Measurements use the selected block
  size and the plug-in's real-time processing mode.

Reports record actual input level and conditions. Nonlinear responses depend
on level and signal history. Increase settle/tail duration for long delays and
reverbs. Noise or large repeat differences reduce frequency/phase confidence.

Memory changes belong to the Electron main process, including shared libraries
and concurrent work. They are estimates rather than exact plug-in allocations.
Concurrent playback and system load also affect processing time.

The chain and report last until the window closes. Closing releases editors and
instances. Unconfirmed resource release quarantines the session; restart Heron
to reset it.
