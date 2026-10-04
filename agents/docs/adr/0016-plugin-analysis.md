# ADR-0016: Plugin Analysis measurement sessions

- Status: Accepted
- Date: 2026-10-04
- Owners: project maintainers
- Related: [ADR-0001](0001-runtime-ownership-and-transactions.md),
  [ADR-0011](0011-protocol-owns-the-wire-shape.md)

## Decision

Plugin Analysis is a standalone secure Electron renderer with an independent,
volatile experiment chain. It reuses catalog, rack, slot and editor presentation.
It receives only `window.heronPluginAnalysis`; handlers authenticate the exact owner
WebContents, main frame and pluginAnalysis entrypoint. It never edits a project or
claims an audio device.

Original and disposable measurement instances share the existing embedded
runtime, with separate identities. They are excluded from document graph
retirement and project dirty notifications. Controller/editor calls remain on
Electron's UI thread. One bounded native worker drives measurement endpoints
in real-time processing mode, then retires them before publishing terminal
status. Analysis, allocation, timing aggregation and serialization run outside
device callbacks. No helper, supervisor or new native IPC is introduced.

Processor clones share instances. Measurements therefore load independent
instances from complete state plus authoritative parameter values. Notifications
and sampled writable parameter changes advance the experiment revision. A
600 ms trailing debounce retains one latest pending parameter/settings intent.
Successful insert/remove/move/bypass commits and enabling automatic analysis
enqueue analysis immediately. That intent remains immediate while the previous
job is cancelled and released, including when parameter notifications arrive.
Launch waits for the current mutation to commit. Cancellation occurs between
blocks; third-party calls cannot be preempted.

Input accepts −60 through +12 dBFS peak, referenced to amplitude 1.0. Floating
point values above ±1 are preserved without clipping, normalization, integer PCM
conversion or hardware output, allowing intentional limiter overload testing.

The analysis window uses one dominant scientific plot with mode controls below
it, following the supplied Plugindoctor v2.6 manual. The experiment chain uses
MixerPluginSection directly, including the same picker, insert faces and gestures.
The window reuses AppTitleBar, including its HeronLogo, platform safe area and
window controls. Visible surfaces contain controls and measurement results;
chain instructions, catalog counts, footer explanations, implementation notes
and debounce/job diagnostics are omitted. Plugin Analysis naming is shared by window ownership, preload authority, IPC
resources, native jobs, generated report types and renderer entrypoints.
Unavailable effects remain discoverable with their compatibility reason. An
explicit Rescan command refreshes bundled probes and external discovery inside
the existing catalog scanner, retaining the chain/report after failure.

Phase automatically expands from a minimum −3° to +3° display range, keeping
grid intervals at least 1° without changing measured values. The input-level
slider displays its local value during a gesture and commits on release or a
keyboard change, keeping per-frame pointer updates out of the mutation queue.
Defaults use a 1 s sweep and 0.25 s settling/tail; users can increase these for
long-delay or long-memory effects.

Harmonics 2D is a measured output spectrogram, not an H2–H8 curve overlay:
time on x, output frequency on y, Hann-windowed spectral magnitude in dBFS as
color. Both exponential and linear sweeps are captured independently; the
exponential output is reused from the linear-response measurement. Each channel
and sweep has at most 192 × 512 cells, from 4096-sample FFT windows and peak
pooling of adjacent bins. The worker checks cancellation between FFT windows.
This includes non-harmonic and reflected alias energy instead of reconstructing
a picture from harmonic orders. H2–H8 and THD remain available in 1D views.
Sweep, channel, 1D scale and color-range switches use the retained report and
do not advance its revision or schedule another job. Renderer polling preserves
report identity only while the accepted run identity is unchanged, and the
snapshot request omits the report body when that identity is current, so the
completed measurement is not re-serialized on every status refresh. Repeated
analysis at the same chain revision still rebuilds the raster; the run identity
is separate from the chain revision used for stale detection.

## Stateful boundary

| Operation | Prepare                                                        | Commit                                                         | Abort / failure                                                    |
| --------- | -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Open      | Allocate session and secure window                             | Publish singleton window                                       | Close candidates on load failure                                   |
| Insert    | Resolve catalog/layout, load original                          | Insert slot and advance revision                               | Unload candidate; quarantine unknown release                       |
| Remove    | Close editor and unload                                        | Remove slot and advance revision                               | Retain slot; quarantine unknown release                            |
| Analyze   | Snapshot state, load independent instances, start explicit job | Publish same-revision report after terminal status and cleanup | Cancel stale work; retain old report; quarantine unknown ownership |
| Cancel    | Clear pending intent, request native cancellation              | Observe terminal cancellation                                  | Never unload a worker-owned endpoint                               |
| Close     | Stop timers, settle mutations, cancel and settle job           | Destroy window after cleanup                                   | Quarantined endpoints remain until runtime shutdown                |

Commands carry session handle, revision, operation ID and idempotency key.
Main retains at most 128 unacknowledged command receipts. Successful renderer
commands acknowledge through an authoritative snapshot read; repeated commands
before acknowledgement reuse their result. Reads reconcile interrupted renderer
transport. Native start/status/cancel/release use an explicit job ID, retaining
terminal status until release. Exceptions stay inside adapters; boundary outcomes
are typed RPC results or recoverable/quarantined session failures.

Application shutdown closes sessions before stopping native UI drains. Unknown
worker outcomes prevent ordinary instance unload. Fatal native plug-in faults
retain the application's existing same-process failure boundary.

## Measurement contract

Exponential sweeps measure four stereo paths independently. Inverse filtering
extracts the fundamental IR with a short pre-zero window preserving its band-limited lobe; frequency analysis removes the excitation
and reference-window response. Display IR buckets retain signed peaks; delay
uses full-resolution samples. Delay is removed before phase unwrap and then
restored. Phase below −100 dB is omitted. Silent RMS, repeated-sweep difference
and tail truncation flag measurement limitations.

Harmonics use settled coherent sine measurements, H2–H8 relative to the measured
fundamental. Orders at/above Nyquist are unavailable. THD sums available orders,
without treating unavailable orders as zero.

The strict Hammerstein model is a fifth-order static polynomial followed by a
512-tap FIR and plug-in-reported delay. Alternating least squares and regularized
spectral estimation fit reproducible multilevel broadband input. Another signal
validates RMS prediction error. The first-order coefficient fixes scale when
identifiable. Independent channel models are unsuitable above 10% validation
error or −40 dB cross response relative to the direct path; dynamic, long-memory or coupled effects can
exceed this approximation without being defective.

CPU metrics time warmed chain calls against the selected block deadline,
excluding FFT, fitting and IPC. RSS deltas describe the main process; the analysis
workspace estimate is separate. Neither claims exact third-party allocations.

`rustfft` becomes a direct host dependency at its already locked version. Rust
owns PluginAnalysis wire/report types and generates declarations for native and shared
contracts consumers. No second report schema is hand-maintained.

## Verification and reconsideration

Native signal tests cover positive dBFS, calibrated gain, delay, cross paths,
coherent harmonics, model prediction and worker retirement. Session tests cover
independent frozen state, parameter debounce, receipts, stale result suppression
and quarantined ownership. An Electron test covers the Help menu, standalone
preload authority, positive-level report and close. The official VST3/CLAP
fixture task also runs the PluginAnalysis native smoke.

Revisit the model if longer memory or coupled-channel identification becomes a
product requirement. Exact plug-in memory accounting requires a new measurement
contract. Export/persistence and additional sample rates need separate delivery
work. The accepted embedded failure boundary remains unchanged.
