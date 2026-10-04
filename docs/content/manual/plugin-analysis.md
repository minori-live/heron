---
title: Plugin Analysis
description: Measure an independent effect chain's response, distortion, model and performance.
---

# Plugin Analysis

Choose **Help → Plugin Analysis…** to open an independent analysis window. You do
not need a project. Add effects using the Mixer plug-in picker and slots, then
open their native or parameter editors. The silent experiment chains do not
change your project.

Plug-in editors open as independent windows. Activating one does not bring the
main Editor forward, and you can keep using Analysis with the Editor minimized
or closed. Removing the effect or closing Analysis also closes its plug-in editor.

The left side uses the same Audio FX slots as the Mixer. Click the first empty
slot to select a vendor, effect and audio mode. **Rescan** refreshes both bundled
and external effects. Unavailable effects show their load/probe reason; they
are not silently omitted from the directory.

## Set the measurement conditions

Open **Measurement settings** at the top right to set linear excitation (Sweep,
Delta or Random white noise), FFT size (16384, 32768 or 65536), processing speed
(Realtime, 2×, 4× or Ultra), sample rate, block size,
frequency range, sweep duration and settle/tail
duration. Defaults are a 1 s sweep and 0.25 s settle/tail.
The **Sweep input level** slider accepts **−60 to +12 dBFS peak**. At 0 dBFS,
the peak amplitude is 1.0; +6 dBFS is approximately 2.0. Heron preserves these
floating point values to test limiters above full scale, without input clipping
or normalization.

Enable **Compare chains** and select **Chain 1** or **Chain 2** above the slots
to edit each independently. Each chain accepts up to sixteen effects. **1 | 2**
overlays both reports; **1 − 2** measures the actual audio output difference,
including phase and latency differences. It does not align the chains' latency.
The individual-chain controls also select which 2D spectrum to inspect. Reports
are published together after the complete comparison batch finishes.

Choose **Analyze**. **Auto analyze** starts after an effect is added, removed,
reordered or bypassed. Parameter, preset and measurement changes are analyzed after editing stops; the input-level slider commits when released. Continue editing while
it runs; superseded reports are marked as describing the previous state.
**Repeat analysis** reruns the complete measurement until cancelled.
**Cancel** stops repetition and pending work and requests cancellation between processing
blocks. A plug-in call in progress must return before cancellation completes.

## Read the report

- **Linear:** frequency response, phase and IR. Select L→L, L→R, R→L or R→R.
  Use the controls below the main graph to switch Magnitude, Phase or IR;
  **L + R** overlays the two direct paths. The **L/R–M/S** toggle in the report
  header reroutes the excitation and folds the stereo output to mid and side,
  so every channel selector reads M/S instead of L/R.
  Select a rectangle on any graph (top-left to bottom-right) to zoom in,
  drag bottom-right to top-left to zoom out, drag bottom-left to top-right or
  double-click to reset, and use the wheel to pan or Ctrl+wheel to zoom an axis. **Store** retains a reference curve
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
- **Hammerstein:** each input power has its own independent 512-tap FIR filter,
  with a fitted DC offset. The static view projects each filter to its DC gain. Select
  the polynomial order from 3 to 7, and compare model predictions against an
  independent measured validation signal. Poor fits highlight the error readout.
  **Per-order response** overlays each order's contribution to the filter
  response. Compression, modulation and long tails often need more complex
  models.
- **Distortion:** single-tone THD and THD+N at a configurable test frequency,
  plus two-tone intermodulation distortion at fixed 60 Hz and 7 kHz carriers.
  Switch THD/IMD to inspect the measured output spectrum, including noise,
  harmonics, reflected aliases and modulation sidebands.
- **Oscilloscope:** sine, square, saw and triangle captures of the chain output.
  **Time** plots output against time with the input overlaid; **Waveshaping**
  plots output against input with a display delay that defaults to the reported
  latency.
- **Dynamics:** the **Ramp** view sweeps the input from −100 to 0 dBFS and plots
  the peak output transfer curve against a 1:1 reference; **Attack / Release**
  feeds three level segments and plots the input and output envelopes.
  Measurement settings configure ramp start/end, step and time per level
  (0.4–1.5 s), plus each segment's level and duration (0.01–5 s). Consecutive
  ramp levels retain signal history. Choose times longer than the effect's attack.
- **Performance:** average/P95/P99/maximum processing time, deadline budget use,
  reported latency and memory estimates. Measurements use the selected block
  size and the plug-in's real-time processing mode. The block-size graph compares
  average and P99 callback time at 64, 128, 256, 512 and 1024 samples.
  Processing speed controls elapsed time independently; pacing is excluded
  from callback timings.

Reports record actual input level and conditions. Nonlinear responses depend
on level and signal history. Increase settle/tail duration for long delays and
reverbs. Noise or large repeat differences reduce frequency/phase confidence.

Memory changes belong to the Electron main process, including shared libraries
and concurrent work. They are estimates rather than exact plug-in allocations.
Concurrent playback and system load also affect processing time.

The chain and report last until the window closes. Closing releases editors and
instances. Unconfirmed resource release quarantines the session; restart Heron
to reset it.
