# Plugin Analysis performance measurements

Plugin Analysis produces the complete report on each run. Switching the visible
analysis page does not change the native workload. Compare identical settings,
plug-in bytes, toolchain, and Cargo profiles; do not compare a debug baseline
with a release optimization.

## Reproduction

Use the locked toolchain from a login shell. On Windows use PowerShell 7, keep
ASIO enabled, and provide the LLVM and ASIO SDK paths described in
[Development environment](environment.md). A short temporary `CARGO_TARGET_DIR`
avoids Windows CMake path-length failures.

Build the baseline and candidate with the same command, preserving each `.node`
binary under a distinct filename before rebuilding:

```powershell
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @heron/dsp-node exec napi build --platform --release --target x86_64-pc-windows-msvc
```

Commit `078d65c` adds only these diagnostics on top of `1d89410c`, the integrated
#197 display-policy baseline. Build that commit for the before measurement and
`74f0345` for the measured candidate implementation (later commits add the
comparison script and this note). Keep the same fixture binary for
both; record its hash even when its historical build settings are unavailable.

The saved Windows release addon SHA256 hashes were
`43cc12419bb0450dde57bf7af4287ee0831af0cffc38c986a586eb622b0cda1b`
before and
`b706755c9bc8635ff8196ea04b88151ac1918071eb76bc7e2304453cf92b6b28`
after. Use the comparison script from the branch tip with both saved outputs.

The native diagnostic test records individual report stages and the total
number of captured frames and calls. It runs only when explicitly requested;
its instrumentation is absent from production builds. Preserve the baseline
test executable so baseline and candidate can be rerun without compilation:

```powershell
cargo test --release --target x86_64-pc-windows-msvc -p heron-audio-host plugin_analysis::profiling::profile_analysis -- --ignored --nocapture --test-threads=1
```

The N-API harness measures real independent plug-in instances, state snapshots,
parameter enumeration and replay, processing, terminal report transfer, and
cleanup. Provide the actual fixture path and native identifier obtained from
the repository's plug-in probe. Store generated output outside documentation:

```powershell
node apps/desktop/scripts/plugin-analysis-profile.ts --addon <baseline.node> --build-profile release --label <revision> --fixture-path <Heron-Gain.vst3> --fixture-id <native-id> --output target/analysis-before.json --report-dir target/analysis-reports-before
```

Run the same command against the candidate binary with separate output paths.
Retain both raw report directories, then compare inputs, workloads, exact
non-harmonic section digests, and harmonic numerical differences:

```powershell
node apps/desktop/scripts/plugin-analysis-compare.ts target/analysis-before.json target/analysis-after.json target/analysis-comparison.json
```

The default matrix covers passthrough, one Gain, and three serial Gain instances;
both a 16,384-point sweep/order-five configuration and a 65,536-point
random/order-seven configuration; and four runs per combination. Iteration zero
is the first run in that combination's new runtime. Later runs reuse the runtime
but recreate every original and disposable plug-in instance. Neither is an OS
cache flush. Add `--include-x4` for explicitly paced runs; use the same matrix
and iteration count on both revisions.

Each output records the native binary and fixture hashes, complete settings,
machine/runtime information, wire sizes, phase observations, timing samples,
and a digest of the numerical report with timing-dependent fields excluded.
The coarse public phase name `model` also covers distortion, oscilloscope, and
dynamics work. Use the native stage instrumentation for attribution, rather
than treating all time under that public phase as model fitting.

The report directory also retains the original completed N-API response as
`.json.msgpack`. Use these native bytes to measure Electron transport separately,
including the production decoder's array representation:

```powershell
node apps/desktop/scripts/plugin-analysis-ipc-profile.ts --wire-response <native-report.json.msgpack> --output target/analysis-ipc.json
```

This runs the production snapshot method and real sandboxed renderer IPC in an
isolated hidden Electron process. A single report and three independently decoded
report objects cover the payload sizes of ordinary and comparison snapshots. A matching
report ID measures normal status polling with the report bodies omitted. The
fixture has no catalog or live plug-in instances; those costs belong to the
N-API harness. Node `structuredClone` and V8 serialization diagnostics in that
harness are transport proxies, not substitutes for this Electron measurement.

Renderer measurements use `plugin-analysis-render-profile.ts`, a production
Vite bundle and isolated Chromium. They include the actual 192 by 512 native
spectrogram dimensions and ordinary line plots. Keep the viewport, device scale,
browser version, source data, color range, and gestures identical. Record first
mount separately from warm gestures and wait for the chart to finish painting.

```powershell
node apps/desktop/scripts/plugin-analysis-render-profile.ts target/analysis-render.json
```

The result records the saved production bundle directory. Set
`HERON_RENDER_PROFILE_BUNDLE` to that directory to rerun a saved baseline after
building the candidate, without rebuilding during timed measurements.

Run timed workloads alone, after all native and JavaScript builds have finished.
Retain individual samples and report their median rather than selecting the
fastest run. Report browser headless timing as such; it is not an interactive
hardware-device or third-party plug-in soak.

## Interpretation

Processing speed deliberately paces captured audio for `realtime`, `x2`, and
`x4`. The full report includes 72 settled harmonic captures and 202 dynamics
level points at the defaults. Faster mathematical analysis cannot remove this
requested audio duration. `ultra` isolates processing and analysis overhead.

The built-in Gain chain exercises real plug-in loading, cloning, parameter
handling, and serial hosting. It does not predict the cost of a third-party
compressor, convolution reverb, or large instrument. Plug-in CPU performance
fields time warmed processing calls; they do not represent whole-report latency.

## Focused changes

The native model fit now reuses its FFT scratch, spectrum, and solver-product
buffers within one fit. It retains the original accumulation order, double
precision, transient exclusion, regularization, convergence threshold, and
iteration limit. A direct finite-convolution oracle checks the causal operator
and its adjoint, including padding and reuse after different inputs.

Coherent harmonic captures now use one double-precision FFT at their original
capture length for all measured orders. The previous implementation performed a
separate trigonometric integration over the same samples for each order. There
is no padding, window change, sample reduction, or shorter settling interval.
Tests cover weak harmonics, odd and non-power-of-two lengths, high bins near
Nyquist, clipping, L/R and Mid/Side routing, silence after reuse, and the existing
amplitude floor and unavailable-order rules. Distortion, response, dynamics,
oscilloscope, cancellation checkpoints, progress reporting, and plug-in lifecycle
remain unchanged.

The renderer change replaces individual spectrogram rectangles with a cached
color raster and explicit lookup of the original measurement for hover. The
report schema and workload, line-plot data, and #197 axis units, minimum spans, frequency floor,
and panning rules remain unchanged.

## Native computation results

Measured on Windows 11 (10.0.26200), AMD Ryzen 9 5950X, with the locked Rust
1.99.0 toolchain, release optimization, and the Windows MSVC target with ASIO.
Saved baseline/candidate test executables ran in B/A then A/B order with no
concurrent builds or other task profiling. Each invocation completed four runs
of each mode: 32 complete jobs, six warm samples per version and mode. These
empty-chain measurements isolate Heron's computation from plug-in processing.

| Mode / stage                        | Before warm median | After warm median |
| ----------------------------------- | ------------------ | ----------------- |
| Sweep 16K/order 5, complete report  | 831.26 ms          | 435.57 ms         |
| Sweep model fit                     | 542.04 ms          | 229.54 ms         |
| Sweep harmonics                     | 128.10 ms          | 39.44 ms          |
| Random 64K/order 7, complete report | 1885.07 ms         | 1061.27 ms        |
| Random model fit                    | 755.99 ms          | 329.65 ms         |
| Random harmonics                    | 516.54 ms          | 147.04 ms         |

Complete-report warm ranges were 767.36–908.55 / 392.83–582.96 ms for sweep and
1744.15–2087.76 / 1011.09–1139.69 ms for random, before / after. Median elapsed
time fell by 47.6% and 43.7% respectively; these are local diagnostic results,
not confidence intervals or a performance guarantee. Other report stages were
not optimized, and their timing variation is not attributed to these changes.

The two first-process sweep runs were 968.78 and 863.55 ms before, and 594.83
and 396.67 ms after. The first random run in each process was 1889.11 and
2026.14 ms before, and 1037.24 and 1118.08 ms after; random followed sweep in
the same process, so these are not cold-process random measurements. Neither
measurement flushes the OS cache or represents application startup.

Every sweep run retained 408 capture calls and 8,408,152 frames. Every random
run retained 416 calls and 16,783,488 frames. Reusing solver buffers accounts
for the largest reduction; exact-length harmonic FFTs remove repeated
trigonometric work without reducing the requested measurements.

The N-API checks compared 34 complete before/after report pairs: 24 in the main
matrix, two additional ultra/x4 pairs, and eight with the separate fixture below.
Excluding timing-dependent CPU-performance fields, every
non-harmonic section, including the fitted models, was exactly equal. Workload
dimensions and unavailable-value masks matched, as did the original MessagePack
numerical section digests. Harmonics are mathematically
equivalent but not bit-identical: the largest fundamental-gain difference was
2.662e-13 dB, harmonic amplitude-ratio difference 1.536e-14, and THD difference
8.134e-13 percentage points. The largest order-level difference in dB was
0.05936 near the existing floor, where a tiny absolute difference is magnified
by the logarithm. Independent analytic weak-harmonic and near-Nyquist tests
provide the accuracy oracle, rather than assuming the old trigonometric sum
is exact.

## Hosted plug-in results

The release N-API builds used Node 26.10.0 and the same local Heron Gain VST3
0.5.2 binary for both matrices. Its historical build flags were not reconstructed;
its module SHA256 is
`1f9312739e98c2bafca19ef00374fb172babafc5f124dc0e853618d239a6232c`.
All chains were unity gain with the harness's copied state and writable
parameters. No installed plug-in configuration was changed.

These are elapsed analysis times through the terminal native response, including
20 ms polling and its final MessagePack decode, but excluding preparation,
repeated diagnostic queries, cleanup, Electron IPC, and chart drawing. Each
matrix has four runs per case: one first-runtime iteration and three warm
iterations. The before matrix preceded the after matrix; unlike the native
stage diagnostic, this matrix was not interleaved.

| Chain / mode        | First run, before / after | Warm median, before / after | Warm range, before / after    |
| ------------------- | ------------------------- | --------------------------- | ----------------------------- |
| Passthrough, sweep  | 0.802 / 0.502 s           | 0.811 / 0.424 s             | 0.768–0.820 / 0.413–0.439 s   |
| Passthrough, random | 3.044 / 1.371 s           | 2.028 / 1.440 s             | 2.005–2.110 / 1.284–1.663 s   |
| Gain ×1, sweep      | 2.172 / 1.767 s           | 2.161 / 1.712 s             | 2.056–2.178 / 1.706–2.117 s   |
| Gain ×1, random     | 4.488 / 3.655 s           | 5.157 / 3.754 s             | 4.695–6.363 / 3.667–4.781 s   |
| Gain ×3, sweep      | 4.632 / 4.186 s           | 4.625 / 4.357 s             | 4.559–4.759 / 4.258–4.366 s   |
| Gain ×3, random     | 10.104 / 10.973 s         | 9.593 / 10.344 s            | 9.351–11.263 / 8.863–11.896 s |

The largest chain's random-mode median increased in this sample, with strongly
overlapping ranges. No end-to-end improvement is established for that case.
These results show why the empty-chain percentage cannot be generalized to
plug-in processing or used as a product-wide speedup claim.

A separate single first-runtime Gain ×3 sweep at `x4` took 44.854 / 44.434 s
before / after. The full lifecycle excluding diagnostic queries took 44.893 /
44.473 s. Pacing still dominates this mode; the measurement confirms complete
reports with matching workloads, not a substantial paced-mode speedup.

For a separate check with a lighter fixture, an existing Heron Gain 0.5.0 DLL
from the local release directory was frozen into a temporary VST3 bundle. Both
revisions used those same bytes, SHA256
`eb60a5175d85647082397a0e1375a716794bf8b5b0a080b9fa0acfd607221ad6`.
This is a historical local artifact, not a freshly rebuilt current release.
The three-instance chain ran four times per mode and revision, baseline then
candidate. Do not compare the two fixture binaries' timings as an optimization.

| Separate Gain ×3 fixture | First run, before / after | Warm median, before / after | Warm range, before / after  |
| ------------------------ | ------------------------- | --------------------------- | --------------------------- |
| Sweep                    | 1.046 / 0.669 s           | 1.025 / 0.654 s             | 0.998–1.050 / 0.645–0.669 s |
| Random                   | 2.645 / 1.694 s           | 2.732 / 1.800 s             | 2.370–3.091 / 1.626–2.868 s |

The random-mode outlier and overlapping ranges are retained. These measurements
exercise actual VST3 hosting and serial processing, but neither fixture predicts
third-party effects or instruments. Node timer observations and isolated browser
gesture timing are separate responsiveness checks; no combined interactive
Desktop/hardware soak was performed.

Host interactions were small compared with the multi-second analysis. Across
the four primary Gain ×3 sweep runs, mean preparation/cleanup overhead excluding
diagnostic repeated queries was 20.69 / 22.41 ms before / after. State/parameter
authority queries were 0.463 / 0.471 ms and parameter replay 0.467 / 0.445 ms;
the separate 96-query diagnostic cost 13.10 / 14.03 ms. No host lifecycle or
parameter-query optimization is claimed.

Completed native responses were about 2.86 MB for sweep and 4.67 MB for random.
For Gain ×3, native terminal-call turnaround averaged 4.10 / 4.56 ms for sweep
and 6.56 / 7.62 ms for random, before / after; decoding averaged 6.34 / 7.63 ms
and 24.03 / 23.50 ms respectively. This is distinct from the Electron transport
measurement below. Across all primary cases the largest observed Node timer gap
was 47.76 / 45.12 ms on a 16 ms timer; it is not a renderer frame-time metric.

## Renderer results

Measured on Windows 11 (10.0.26200), AMD Ryzen 9 5950X, Chromium
153.0.8010.12, with a production/minified Vite bundle, a 1000 by 500 CSS-pixel
plot, and device scale factor 1. The baseline is the integrated #197 code
(`1d89410c`; its tree matches the saved `566cf1a` bundle). Both versions used
the same deterministic data and alternating Ctrl-wheel gestures.

| Plot                         | First mount, before / after | Warm zoom median, before / after |
| ---------------------------- | --------------------------- | -------------------------------- |
| Stereo, 2 × 384 points       | 70.5 / 74.8 ms              | 33.00 / 32.95 ms                 |
| Comparison, 4 × 384 points   | 72.3 / 83.5 ms              | 33.00 / 33.05 ms                 |
| Spectrogram, 192 × 512 cells | 1252.2 / 96.7 ms            | 949.90 / 33.00 ms                |

Warm results contain 12 samples per plot and revision. First mount has one
sample per fresh page and includes the lazy chart adapter, with ECharts core
already loaded by diagnostic instrumentation; it is not cold application
startup. Elapsed time includes Vue updates, raster construction, ECharts
completion, and two animation frames used to confirm painting. Those frames
explain the roughly 33 ms floor. Ordinary line plots show no meaningful speedup.

The spectrogram previously created and progressively repainted 98,304 ECharts
rectangle objects on each gesture. A cached cell-color raster now supplies one
image while ECharts retains the axes and legend. The warm gesture elapsed time
fell by 96.5% on this fixture. Source values, cell boundaries, colors, and
nearest-neighbor display remain unchanged; hover resolves the original cell,
not a resampled pixel. Browser validation checked raw-value tooltips and both
crosshair guides after zoom. The small automatic visual-map hover marker is
absent for the raster; the color scale and numerical tooltip remain present.

Regression coverage includes missing/nonfinite cells, out-of-range levels,
half-width edge cells, logarithmic positioning, clipping, color changes, device
scale and resize, mutation/remount invalidation, and hover after zoom. Existing
axis precision, minimum spans, frequency-floor panning, and navigation tests
remain in the focused suite.

## Report transport profile

The unchanged main/renderer transport was profiled with Electron 44.5.1 and an
actual 2,858,620-byte native response. Each comparison report was decoded
independently with the production MessagePack decoder before timing. This avoids
the different array representations produced by JSON parsing or mixing parsed
and cloned fixtures. It models payload size; it does not claim to run three
distinct comparison chains.

| Snapshot payload                | First request | Warm median (20 samples) | Warm p95 | Main snapshot clone median |
| ------------------------------- | ------------- | ------------------------ | -------- | -------------------------- |
| One complete report             | 150.8 ms      | 125.30 ms                | 142.8 ms | 52.36 ms                   |
| Three complete reports          | 371.6 ms      | 368.65 ms                | 406.5 ms | 145.93 ms                  |
| Known report ID, bodies omitted | 1.4–1.5 ms    | 0.20 ms                  | 0.30 ms  | about 0.02 ms              |

Elapsed time uses real `ipcRenderer.invoke`, the RPC success envelope, and a
sandboxed context bridge. The remainder after snapshot cloning includes IPC
serialization, scheduling, and context-bridge copies; it is not a standalone
serialization CPU measurement. Startup, decoding, authentication, native work,
and drawing are outside this interval. No transport changes or transport
speedup are claimed. Report-identity suppression already makes routine polling
cheap, while first publication of comparison reports remains a visible cost.

## Validation evidence

The native release suite passed 32 Plugin Analysis tests, with the timing
diagnostic intentionally ignored in ordinary test runs. Release Clippy and
package rustfmt passed. Both before and after N-API artifacts were built with
the same release command and ASIO enabled.

The shared UI suite passed 206 tests and the Desktop analysis suites passed
79 tests. Focused browser rendering and hover checks exercised the actual
production ECharts adapter. TypeScript checks cover the UI, Desktop, diagnostic
scripts, and repository tool configuration. Repository lint, design audit,
UI-boundary checks, source-size policy, and formatting passed. Timings are
diagnostic evidence, not machine-dependent CI pass/fail thresholds.
