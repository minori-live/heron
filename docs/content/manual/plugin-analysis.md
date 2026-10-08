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

Open **Measurement settings** at the top right. The settings panel docks beside
the report, so results stay visible while you change it. Set linear excitation (Sweep,
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

Choose **Analyze**. The status beside it shows the current measurement phase
and progress, or whether the results are up to date. **Auto analyze** starts after an effect is added, removed,
reordered or bypassed. Parameter, preset and measurement changes are analyzed after editing stops; the input-level slider commits when released. Continue editing while
it runs; superseded reports are marked as describing the previous state.
**Repeat analysis** reruns the complete measurement until cancelled.
**Cancel** stops repetition and pending work and requests cancellation between processing
blocks. A plug-in call in progress must return before cancellation completes.

## Read the report

Every axis and tick shows its unit; phase is in degrees (°). Linear amplitude
uses FS, where 1 FS is amplitude 1.0 (0 dBFS peak). The spectrum color scale
uses dBFS. Automatic scaling and zoom keep minimum grid steps of 1 Hz,
1 dB/dBc/dBFS, 1°, 0.01%, 0.01 FS, 0.01 ms, 0.001 s, 0.1 μs or 1 sample,
depending on the axis. Small measured values are preserved without magnifying
numerical noise into a full-scale response.

Hover over a curve to see the series name and measured coordinates in the displayed
units. In the 2D sweep spectrum, hover over a cell to see its measurement time,
frequency band and peak level in dBFS. Color-range limits change the colors;
the tooltip keeps the original measured level.

Continuous response curves use light display smoothing; measured coordinates and
unavailable bins are preserved. Phase, impulse and captured waveform views retain
straight sample connections to preserve discontinuities.

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

## Fit a parametric EQ

In **Linear → Magnitude**, select one input-to-output path, such as **L→L** or
**M→S**, then choose **EQ Fit** to open its separate window. The entry is hidden
for the default **L + R** (or **M + S**), which overlays two measured paths,
for the **1 − 2** difference view, and outside Magnitude. When viewing both
comparison chains, select the chain to fit in the EQ Fit window; an
individual-chain view already identifies it.

In the new window, set the EQ quota from **1 to 24**, default **3**, and choose
**Fit EQ**. The result contains at most that many **Bell**, **LowShelf** or
**HighShelf** sections, each with Frequency, Gain and Q. **Overall Gain** is
separate and does not use the quota; a flat response may need no sections.
The fitted curve approximates the **measured response**.
It is not an inverse correction, and fitting does not insert effects into a chain.

Choose **Heron EQ preset** below the parameters to show and copy the portable
JSON containing static band settings. To apply the result, copy the complete JSON, add a new empty **Heron EQ**
instance in **Zero latency**, open its top-bar **⋯** menu and choose the clipboard
icon whose tooltip starts with **Paste bands**.
Pasting adds the fitted bands and preserves the destination's processing mode
and output settings; separately set its output gain to **Overall Gain**.
A flat fit with no bands needs only the output gain setting, so skip pasting.
Save the project to retain the settings. This transfers bands rather than importing
a whole preset; Heron's host state recall uses a separate VST3 state format.
The native EQ editor displays only its own Pre/Post and routed sidechain audio;
band transfer does not display or control the measured source plug-in.
At the measurement sample rate, its Zero Latency mode
reproduces the fitted curve with one RBJ filter section per band, using the same frequency, gain and Q values.
Bell and shelf bands do not display a dB/oct roll-off.
The fit data does not reproduce the measured plug-in's original phase or
cross-channel routing. Larger quotas can take longer; **Cancel** remains available.

The EQ Fit window's magnitude graph overlays the measured and fitted curves.
The residual is **measured − fitted**, in dB. RMS error and maximum absolute
error summarize the original measured frequency bins with equal weight; display
smoothing is not fitting input. The flat-gain baseline shows the RMS error using only the best
constant gain within the overall-gain bounds, before adding EQ sections.
Elapsed fitting time describes that run and depends on the response, quota and
computer. A small sampled error does not prove accuracy between measured bins.

Use **Cancel** to stop a fit. A new report, an edited experiment, or a change to
the path, chain, comparison mode or quota clears the result and cancels an active
fit. Choose **Fit EQ** again for the new target. Leaving **Linear → Magnitude**
also clears the fit. If the source is unavailable, the window stays open and
prompts you to select a current single path in Linear Magnitude. Repeated analysis
produces new reports, so wait for a report you want to inspect before fitting it.

Choosing **EQ Fit** again for the same target brings the existing window forward
and retains its quota and result. Closing that window cancels its work and
discards the fit; reopening starts with quota three and no result. Closing Plugin
Analysis also closes its EQ Fit window.

The search evaluates digital biquads at the report's sample rate. It tries several
starting points and filter types within these bounds; it does not guarantee a
global optimum. Increasing the quota can improve an approximation but cannot
make every response representable.

| Parameter    | Bounds                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Frequency    | From the greater of 10 Hz and the first measured frequency to the least of 24 kHz, 0.475 × sample rate and the last measured frequency |
| Section Gain | −24 to +24 dB                                                                                                                          |
| Q            | 0.2 to 12                                                                                                                              |
| Overall Gain | −60 to +60 dB                                                                                                                          |

Q follows the [RBJ Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/)
coefficient convention for Bell and both shelves:
`A = 10^(Gain/40)`, `ω₀ = 2π × Frequency / sample rate`, and
`α = sin(ω₀)/(2Q)`. Shelf Q is related to shelf slope S by
`1/Q² = (A + 1/A) × (1/S − 1) + 2`.
Q ≈ 0.7071 corresponds to S = 1; higher shelf Q permits resonant overshoot.
Another EQ's Q or slope control may use a different convention.

Fitting rejects malformed data, fewer than 64 bins, less than two octaves of
coverage, no usable signal, any bin at or below −100 dB, extreme levels or severe
roughness. This intentionally excludes finite values near the measurement's
−240 dB floor. Truncated tails or more than 10% repeat error also block fitting.
Increase settle/tail time or repeat the measurement after resolving its cause.
Low levels, limited bandwidth, roughness, noise, smaller repeat differences,
parameter bounds, high Q and large residuals can produce warnings.

These checks are conservative heuristics. The report has no per-bin confidence
or SNR mask, so warnings cannot distinguish every real feature from noise or
crosstalk. Only 384 log-spaced frequencies are reported; narrow high-Q features
may fall between them. The fit does not model phase, delay, nonlinear or changing
behavior, and cannot recover the original plug-in's internal settings. A fitted
cross-channel magnitude does not reproduce stereo routing or coupling when
entered into an ordinary single-channel EQ.
