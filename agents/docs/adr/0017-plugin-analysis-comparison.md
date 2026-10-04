# ADR-0017: Plugin Analysis comparison and independent order identification

- Status: Accepted
- Date: 2026-10-05
- Related: [ADR-0016](0016-plugin-analysis.md), [ADR-0011](0011-protocol-owns-the-wire-shape.md)

## Decision

The analysis session owns two explicit volatile chains, addressed by the session
handle and chain index. Inserts retain independent order, bypass and editor state.
Each chain accepts up to sixteen effects. The comparison display offers both
chains, either individual chain, and the actual sample-wise output difference
of the chains under the same excitation. Difference processing uses independent
endpoints and preserves phase and latency differences; it never subtracts dB
magnitudes or implies automatic latency alignment.

Main runs the two chain measurements and the difference measurement sequentially
on the existing bounded native measurement worker. Every job loads disposable
instances from state and authoritative parameters. A batch publishes all reports
at one commit point after worker termination, job release and endpoint cleanup.
Edits invalidate the entire batch. Cancellation stops remaining groups and
repetition. Prepare failures retain previous reports; unconfirmed cleanup
quarantines all remaining owned endpoints. Repeated commands retain the existing
receipt and resource-generation semantics. Report-body omission and renderer
retention apply to the entire batch identity.

Linear analysis adds calibrated delta and deterministic white-noise excitation
alongside exponential sweep deconvolution. These are different experiments for
nonlinear and time-dependent effects. FFT quality is bounded to 16384, 32768 or
65536 samples. Spectrogram FFTs use one quarter of that size. Processing speed
controls worker pacing at 1x, 2x, 4x or unlimited speed, independently of the
plug-in's real-time processing mode. Pacing waits check cancellation every 2 ms;
processing callbacks themselves are still non-preemptible.

The previous strict Hammerstein model (one polynomial followed by one FIR) is
superseded by a parallel Hammerstein model: each normalized input power has an
independent 512-tap causal FIR, plus a fitted DC offset. Bounded, regularized
conjugate-gradient regression uses FFT convolution and its adjoint. Independent
validation and cross-channel suitability checks remain mandatory. A static
projection uses the DC gain of each order, while order curves use each actual
FIR. The model remains unsuitable for coupled channels, modulation, dynamics or
memory longer than the filter and capture windows.

Dynamics bounds ramp levels, step, time per level, and each of three envelope
levels and durations. Consecutive ramp levels retain processor history.
Explicit repetition reruns the complete batch and retains cancellation and
revision rules. Performance reports include warmed callbacks at five supported
block sizes; FFTs, identification, pacing and IPC are excluded from timings.
No hardware stream, helper process or callback-boundary work is introduced.

Rust owns the expanded settings and reports and generates TypeScript declarations.
Missing settings fields in native requests use the previous measurement defaults
plus the new quality/dynamics defaults; renderer mutations require the complete,
validated settings shape. The native start request may carry a separate optional
comparison endpoint list, with identity, duplicate and cardinality validation.

## Consequences and evidence

Signal tests cover calibrated broadband gain/delay, measured spectra and
fundamental gain, distinct per-order filters, configured dynamics, callback-size
metrics, sample-domain comparison and cancellable pacing. Session tests prove
independent chain ordering, atomic batch publication and repetition cancellation.
Electron coverage owns the secure preload, settings and comparison display flow.

Disk/CLI loading, export, persistence, external hardware, hosting the analyzer as
a plug-in and analysis-specific colour customization remain outside this change.
External plug-in format and architecture compatibility require separate decisions.
