# Plugin Analysis

Plugin Analysis owns a secure auxiliary renderer, two volatile experiment chains
and reports independent of projects and audio devices. [ADR-0016](adr/0016-plugin-analysis.md)
explains this ownership; [performance notes](plugin-analysis-performance.md) own
measurement-cost investigations. This document owns the feature contract.

## Sessions, instances and jobs

Only `window.heronPluginAnalysis` is exposed. Handlers authenticate the exact
owner WebContents, main frame and entrypoint. Chains are explicitly addressed by
session and index; each accepts at most sixteen effects with independent order,
bypass and editor state. Instances remain in the embedded host but are excluded
from document graph retirement and dirty notifications. Controller/editor work
stays on Electron's UI thread.

Measurement loads disposable independent instances from complete state and
authoritative parameters; cloning processor handles would share live state.
One bounded native worker drives real-time-mode endpoints. Allocation, FFTs,
fitting, timing aggregation and serialization happen outside device callbacks.
Cancellation occurs between blocks; third-party calls are non-preemptible.

Notifications and sampled writable parameter changes advance experiment revision.
A 600 ms trailing debounce retains the latest parameter/settings intent.
Successful insert/remove/move/bypass and enabling automatic analysis enqueue
immediately. That immediate intent survives cancellation/cleanup and intervening
parameter notifications. Launch waits for mutations to commit.

Measure chain A, chain B and actual sample-wise A−B sequentially under the same
excitation. Difference retains phase and latency differences; it is neither a
dB subtraction nor automatically aligned. Publish the entire batch at one commit
after worker termination, release and endpoint cleanup. Edits invalidate the
batch; cancellation also stops remaining groups and repetition. Preparation
failure retains previous reports. Unknown cleanup quarantines remaining endpoints.

| Operation | Commit                                                 | Failure and cleanup                                                  |
| --------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Open      | Publish the prepared singleton window                  | Destroy failed candidates; owner disposal invalidates pending loads  |
| Insert    | Insert loaded original and advance revision            | Unload candidate; quarantine unknown release                         |
| Remove    | Remove slot after editor close/unload                  | Retain slot if release is unconfirmed                                |
| Analyze   | Publish current batch after terminal cleanup           | Cancel stale work; retain prior report; quarantine unknown ownership |
| Cancel    | Observe terminal cancellation                          | Never unload worker-owned endpoints                                  |
| Close     | Destroy window after timers, mutations and jobs settle | Retain quarantined endpoints until runtime shutdown                  |

Commands carry resource, revision, operation ID and idempotency key. Main retains
at most 128 unacknowledged receipts. Successful commands acknowledge through an
authoritative snapshot; replay before acknowledgement reuses the result. Native
jobs have explicit start/status/cancel/release IDs and retain terminal status until
release. Boundary failures are typed recoverable/quarantined outcomes.

Shutdown closes analysis before native UI drains stop. Offline bounce closes it
before replacing the runtime while the old client can release instances. Unknown
worker outcomes prohibit ordinary unload. Fatal faults retain the same-process
application failure boundary.

## Measurements

Floating-point excitation accepts −60 to +12 dBFS peak relative to amplitude 1.
Values beyond ±1 are preserved without clipping, normalization, integer conversion
or hardware output. Settings include tone frequency from 20 Hz to 0.45 sample rate,
polynomial order 3–7, L/R or M/S routing, excitation, FFT quality and pacing.
M/S folds M=(L+R)/2 and S=(L−R)/2 through the existing worker.

Linear analysis offers exponential-sweep deconvolution, calibrated delta and
deterministic white noise. They are different experiments for nonlinear or
time-varying effects. FFT sizes are bounded to 16384, 32768 or 65536; spectrogram
FFTs use one quarter. Worker pacing is 1x/2x/4x/unlimited independently of plug-in
processing mode, with cancellation checked during waits every 2 ms.
Default sweep duration is 1 s with 0.25 s settling/tail, adjustable for long memory.

Sweep analysis measures four stereo paths independently. Fundamental IR extraction
preserves its band-limited pre-zero lobe and removes excitation/reference-window
response. Display IR buckets retain signed peaks; delay uses original samples.
Remove delay before phase unwrap and restore it afterward; omit phase below −100 dB.
Silent RMS, repeated-sweep differences and truncated tails flag limitations.

Settled coherent sines measure H2–H8 relative to the measured fundamental. Orders
at/above Nyquist are unavailable, not zero; THD sums available orders. Distortion
adds single-tone THD/THD+N and fixed 60 Hz/7 kHz two-tone IMD. Oscilloscopes capture
sine, square, saw and triangle. Dynamics bounds ramp levels/step/time and three
envelope levels/durations; consecutive ramp levels retain processor history.

Harmonics 2D shows measured output spectrograms: time, frequency and Hann-windowed
dBFS magnitude. Exponential and linear sweeps are independently captured;
exponential output reuses the linear-response measurement. Peak-pooled grids are
bounded to 192 × 512 per channel/sweep; cancellation is checked between FFT
windows. They include non-harmonic/alias energy, not reconstructed H2–H8 curves.

The current parallel Hammerstein model gives each normalized input power its own
512-tap causal FIR plus fitted DC offset. Bounded regularized conjugate-gradient
regression uses FFT convolution/adjoint. Independent validation and cross-channel
checks are mandatory. DC gains form the static projection; actual FIRs form order
curves. Over 10% validation error or cross response above −40 dB relative to the
direct path marks independent-channel models unsuitable. Coupling, modulation,
dynamics or longer memory can exceed this approximation without a plug-in defect.
The earlier single-FIR strict Hammerstein model is historical.

CPU metrics time warmed callbacks at five supported block sizes against their
deadlines, excluding FFT, fitting, pacing and IPC. RSS deltas describe main process
memory; workspace estimates are separate. Neither measures exact third-party
allocations. Rust owns settings/report wire shapes and generated TypeScript.
Native missing settings fields use compatible defaults; renderer mutations submit
a complete validated shape. Optional comparison endpoints validate identities,
duplicates and cardinality.

## Coordinates and presentation

Oscilloscope points carry positive `sample_stride` in original samples; point i
is at `i * sample_stride / sample_rate`. Input/output share stride and origin.
`delay_samples` remains original-sample units and duration covers the full capture.
Waveshaping linearly interpolates fractional delayed output and omits positions
outside overlap. Never derive stride from nominal duration or round delay to a
retained-point index. Each report uses its own rate/stride/delay.

All axes name units. Minimum grid steps are 1 Hz, 1 dB/dBc/dBFS, 1°, 0.01%,
0.01 FS, 0.01 ms, 0.001 s, 0.1 μs and 1 sample. Shared UI keeps at least eight
minimum steps on x and six on y across automatic, explicit and gesture domains.
Log frequency does not pan below 1 Hz; phase auto-range starts at −3° to +3°.
Linear ticks use rounded intervals and precision matching their steps. Display
limits do not round or alter measurement data.

The dominant scientific plot has per-view controls, a neutral readout strip and
a shared command bar with one phase/progress state. Settings use a docked nonmodal
inspector; the sidebar reuses MixerPluginSection and chain comparison. AppTitleBar
owns window chrome. Display results and actionable state, avoiding implementation
notes, job IDs and catalog counts. Rescan uses existing catalog discovery and
retains chains/reports on failure; unavailable effects show compatibility reasons.
Input-level drags display local preview and commit on release/keyboard change.

Plot zoom/pan/reset and channel/sweep/scale/color changes use retained reports
without launching measurements. Snapshot requests omit report bodies for the known
batch identity. Repeated runs at the same experiment revision still have distinct
identities and rebuild plot data. The shared ECharts adapter owns resizing, theme
and disposal; spectrogram hover exposes original FFT time/band/peak values.

Analysis reports remain volatile. Disk/CLI loading, report export/persistence,
external hardware and an analyzer plug-in are outside current scope. Portable
EQ Fit export is separate; see [EQ integration](heron-eq.md#eq-fit-window-and-computation).
