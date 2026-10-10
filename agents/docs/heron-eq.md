# Heron EQ host integration and fitted-preset interchange

[Heron Plugins](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/README.md)
owns the native EQ source, DSP, editor and their tests. Its
[EQ notes](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/heron-eq.md)
maintain the feature, filter, preview-worker and editor acceptance contracts.
This document owns Heron's integration and fitting/export requirements.
[ADR-0029](adr/0029-native-heron-eq.md) and
[ADR-0030](adr/0030-eq-graph-and-floating-controls.md) retain the original
decisions; [ADR-0031](adr/0031-artifact-delivered-built-in-plugins.md) records the
source and release ownership change.

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
