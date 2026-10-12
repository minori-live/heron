# Heron EQ host integration and fitted-preset interchange

[Heron Plugins](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/README.md)
owns the native EQ source, DSP, editor and their tests. Its
[EQ notes](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/heron-eq.md)
maintain the feature, filter, preview-worker and editor acceptance contracts.
This document owns Heron's integration and fitting/export requirements.
[ADR-0031](adr/0031-artifact-delivered-built-in-plugins.md) explains the source and
release ownership choice. The [ADR index](adr/README.md#2026-10-12-consolidation)
links the original EQ records for historical rationale.

## Ownership

Heron owns:

- The renderer's `apps/desktop/src/renderer/src/lib/eq-fit/` magnitude fitter and
  portable preset export.
- The built-in catalog, actual VST3 capability probe, embedded audio host,
  parameter gestures and opaque project-state persistence.
- Prepared-bundle response/automation tests, native hosted editor resize and
  lifecycle tests, and browser fitting/export/cancellation acceptance.
- Numerical and historical compatibility fixtures under
  `crates/audio-host/tests/fixtures/eq-fit/`.

The producer owns `crates/plugin-dsp/src/eq/`, `plugins/heron-eq/`, shared Iced
widgets and pinned toolkit patches. Heron prepares released VST3 bundles as
described in [built-in distribution](builtin-plugin-distribution.md); it has no
plugin source dependency. Plugin runtime/UI tests belong to the producer.

## Fitted-preset contract

The renderer fitter and native Zero Latency processor use the same digital RBJ
Bell/LowShelf/HighShelf convention: one section per fitted band, unchanged
frequency/gain/Q and an independent output gain. Stored `slope_db_oct: 12`
selects the single-section configuration; it is not a Bell's asymptotic roll-off.
`fit-preset.json` and `fit-response.json` in Heron's fixture directory retain
the 48 kHz numerical contract. The producer's corresponding fixtures live in
`plugins/heron-eq/tests/fixtures/`; they are separately owned compatibility
copies. Preserve their provenance rather than regenerate expected responses
from the current implementation.

Portable exports use
`{ "format": "heron-eq", "version": 1, "config": EqConfig }` with static bands
and no dynamic-processing fields. They are distinct from opaque VST3
component/controller state chunks. Heron currently has no full portable-preset
importer. To apply a fit, copy the exported JSON into an empty Zero Latency EQ
instance using Tools → Paste bands, then set output gain to Overall Gain.
Pasting appends bands and preserves destination globals. A flat, zero-band fit
needs only the output gain setting.

The fitter's quota is an upper bound, not an exact count or optimality
certificate. Its default remains three bands and search remains cancellable.
This is the renderer fitter's policy; the native sidechain Match has a separate
bounded slot policy. Fit exports describe magnitude filters at the selected
sample rate. They cannot reconstruct phase, delay, nonlinearities or the source
plugin's channel routing.

## Host and project compatibility

Heron EQ retains processor class `live.minori.heron.eq` and canonical Windows
VST3 class ID `8A8341D5CA36B6C9A9572788F40EBB9F`. Heron's runtime confirms actual
mono, mono-to-stereo and stereo layouts, stereo sidechain, event buses and editor
support through the prepared bundle. Category or manifest metadata alone does
not prove MIDI capability or audio behavior.

Heron saves and restores opaque VST3 state with the project. The legacy state
smoke restores all four original plugins together. The old three-plugin
[project fixture](legacy-builtin-project-fixture.md) and EQ's separate Heron
0.6.5 source fixture retain explicit provenance; the producer's initial 0.6.4
suite version does not change that baseline.

The packaged EQ test measures seven sine responses in all three host channel
modes against the fitting fixture. Its output automation test proves causality
at a 32-sample boundary. The locked Truce wrapper coalesces host automation into
sub-blocks of at least 32 samples; MIDI event offsets do not establish
one-sample precision for arbitrary host parameter automation.

Each hosted editor operates on one instance. Closure revokes its host bridge,
balances outstanding gestures and clears only its generation's solo ownership.
Heron's queued callback evidence does not establish behavior for external DAWs
that destroy an editor reentrantly inside a parameter callback. AU/other-DAW
acceptance belongs to the producer's release gates.

## Verification

Run from the repository-managed login shell; Windows uses PowerShell 7:

```sh
mise run test:builtin-vst3
mise exec -- cargo test -p heron-audio-host --test builtin_eq_resize -- --ignored --test-threads=1 --nocapture
mise exec -- pnpm --filter @heron/desktop check
mise exec -- pnpm --filter @heron/desktop exec playwright test e2e/plugin-analysis-eq-fit.spec.ts --workers=1
```

These checks consume the prepared, pinned bundle. The first release must be
selected before native integration validation can run; see
[cutover and preparation](builtin-plugin-distribution.md).

`builtin_eq_resize` requires an interactive Windows desktop and GPU. At actual
per-window DPI and 100%/125% host zoom, negotiated VST3 view and child HWND must
have the same physical extent. The test repeats
1120 × 760 → 1500 × 950 → 1040 × 700 → 1120 × 760, checks pointer hits on bypass,
nodes and Gain, and verifies attached-view zoom, Escape, focus loss and closure
during parameter edits. It preserves native identity, platform fallback mapping
and replacement-child coordinates after the prior input-drift fix.
Toolkit patch provenance and the separate GPU widget/render evidence live in
the producer's [EQ verification notes](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/heron-eq.md).

Browser evidence must cover the Chinese result-area regression, preset export
and cancellation. Rendered plugin screenshots do not prove browser behavior,
live native-window coordinate routing or hardware audio. Heron's integration
checks complement the producer's DSP, editor, real-time and release-format
checks; neither suite substitutes for the other.

## EQ Fit window and computation

Main owns one independent top-level EQ Fit window per Analysis owner. Entry is
available only for one measured Linear Magnitude input/output path, excluding
L+R, M+S, difference and other views. Overlaid comparison requires explicit chain
selection inside the fit window. Reopening the same target focuses it and retains
controls; close discards fitting state, and a later open starts at quota three.

The fit renderer receives its own narrow preload, authenticated by owner, main
frame and entrypoint. Main resolves report ID/revision and semantic path from its
authoritative report; opener-supplied arrays never become the target. The window
can inspect context and control itself, but cannot mutate projects, chains or
native instances. Typed outcomes handle failures without ambient report state.

Selection requests carry Analysis handle, revision, mutation identity, monotonic
sequence, nullable selection and explicit open intent. Main validates before
acceptance, replays duplicates without reopening/refocusing, rejects older
sequences and exposes the last sequence for reload reconciliation. Manual child
close retains that receipt/sequence; a new owner resets it. Child snapshots carry
source/selection revisions and omit known report bodies. Window commands use
explicit maximize state and bounded acknowledged receipts.

A dedicated renderer Web Worker receives immutable raw frequencies, magnitudes,
sample rate and settings. One worker per fit window is terminated on cancellation,
replacement or disposal. It has no native/project authority. Generation and target
identity include report ID/revision, experiment revision, comparison, path, chain
and quota. Any relevant change terminates work and clears results. Late callbacks
cannot publish. A new measurement invalidates fits even at the same experiment
revision; unchanged snapshot identity does not. Invalid context leaves the window
open with a request for a current single magnitude path. Worker failure permits
retry while preserving the measurement report.

Owner disposal closes the child before Analysis cleanup. Failed loads destroy
candidates; late load/context completion cannot resurrect an owner. Child close
terminates fitting without closing Analysis. The only fit commit is publication
of a current result; portable export remains read-only with respect to the host.

Quota is 1–24 sections, default three, with independent overall gain outside it.
Bounded multi-start nonlinear least squares chooses Bell/LowShelf/HighShelf types
and finite frequency/gain/Q bounds. Evaluate digital RBJ response at the report's
sample rate and original bins; reject invalid/unstable candidates. All three use
`alpha = sin(2*pi*f/Fs)/(2*Q)`. Shelf Q is damping, not a universal shelf-slope
setting. Fit measured magnitude, not inverse correction or smoothed plot pixels.

Reject malformed/insufficient input, unusable floors and clearly unreliable
measurements; surface weaker diagnostics as warnings. No per-bin confidence mask
exists, so a successful fit cannot certify measurement confidence. Accept/reject
the whole input rather than silently dropping bins. Equal-weight raw-bin residual
is measured minus fitted dB; display RMS, maximum absolute residual, elapsed time
and the bounded gain-only baseline (mean measured dB clamped to gain limits).
The current report has 384 log-frequency samples per path; inter-bin narrow
features remain unresolved. Search is reproducible for an identical input but
makes no global optimum claim. It models neither phase/delay/nonlinearity nor a
stereo transfer matrix. A cross-path fit cannot create routing in an ordinary EQ.

## Producer compatibility boundary

The producer owns current DSP, native UI, preview/preparation workers, telemetry
and toolkit patches. Heron does not carry a second copy of that specification.
Preserve 24 stable parameter slots and separate processing order: deleting a band
cannot renumber automation. Presence differs from bypass. Retired dynamic offsets
and Character global ID 6 remain reserved; static IDs and saved state retain their
meaning. Host multichannel support is not implied by stereo M/S controls.

Portable v1 static presets reject nonfinite values, duplicate/out-of-range IDs,
more than 24 bands and unsupported combinations before replacement. Explicit
output defaults apply; the retired top-level `character` field is ignored and
omitted on export, while other envelope validation remains strict. Legacy dynamic
fields cannot re-enable retired processing. Band paste failure preserves settings.
Heron has no live-instance directory or cross-editor bridge; clipboard transfers
explicit settings only. Host history/presets are not implemented by reintroducing
local native history or whole-preset controls.

Native Pre/Post and sidechain spectra must describe actual instance audio, never
a response curve substituted for measured Post. EQ Match uses the instance's
sidechain; other live instances are not reference/control targets. Host latency
must describe the active processor; pending/failed preparation keeps prior audio
until a valid replacement, with off-callback publication/retirement. The producer
owns detailed DSP/editor validation; Heron verifies retained state, automation,
latency, editor lifecycle and fitted-preset behavior at its integration boundary.
