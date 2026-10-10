# Heron EQ implementation and verification

The EQ workflow uses direct graph editing, Heron's own static algorithms and a
maximum of 24 bands. [ADR-0029](adr/0029-native-heron-eq.md) records the native
ownership, real-time constraints and fitted-preset compatibility contract.
This document distinguishes implemented behavior from verification and remaining
compatibility work; the presence of an editor control alone is not evidence of
audio processing.

## Ownership

The [heron-plugins repository](https://github.com/minori-live/heron-plugins)
owns `crates/plugin-dsp/src/eq/`, `plugins/heron-eq/`, its native editor tests
and the vendored Truce UI fixes. The processor, native parameter slots,
preparation workers and editor move together, without changing their runtime
or state semantics. [ADR-0031](adr/0031-artifact-delivered-built-in-plugins.md)
records that ownership change.

Heron owns `apps/desktop/src/renderer/src/lib/eq-fit/`, portable preset export,
the plug-in catalog, and integration tests under `crates/audio-host/tests/`.
These tests load the prepared VST3 artifact and retain normative fitting fixtures
locally. `heron-plugins.lock.json` pins the producer release; the installed
manifest and actual probe determine discovery and capabilities.

The processor class is `live.minori.heron.eq`. Its canonical Windows VST3 class
ID is `8A8341D5CA36B6C9A9572788F40EBB9F`. Audio layouts support mono,
mono-to-stereo and stereo, with an explicit stereo sidechain bus. These are the
current host's channel modes; layouts with more than two main channels are not supported.

## Feature contract

| Area           | Heron behavior                                                                                               | Required evidence                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Bands          | At most 24; stable slot IDs; independent presence and bypass                                                 | Add/delete/reuse, parameter/state recall and 24-band audio                  |
| Editing        | Frequency/gain dragging, Q wheel, numeric inputs, group selection, axis locks, delete, duplicate and solo    | Gesture cancellation, balanced host edits and native rendering              |
| Filters        | Bell, shelves, cuts, notch, band pass, tilt shelf, flat tilt and all pass; continuous roll-off for cuts/pass | Stable impulse/sine response and channel projection                         |
| Channels       | Stereo, Left, Right, Mid and Side per band                                                                   | Independent signal tests, including mixed projections                       |
| Analyzer       | Actual Pre, Post and sidechain samples; freeze, configurable resolution/speed/tilt/range                     | Measured spectra, display-only tilt, overflow and sample-rate changes       |
| Matching       | Measured sidechain magnitude target from this instance, with a bounded fit using available band slots        | Raw spectra retained independently of analyzer display settings             |
| Grab/Piano     | Measured peak selection and note snapping                                                                    | Editor gestures and capacity policy                                         |
| Modes          | Digital Zero Latency, oversampled Natural Phase, symmetric FIR Linear Phase                                  | Actual kernels, reported latency, bounded preparation and retirement        |
| Output         | Gain, mute, L/R or M/S balance, gain scale, automatic gain, polarity and global bypass                       | Audible gain/polarity; bypass covers every stage with compensated dry audio |
| Host edits     | Host-owned undo/redo with balanced parameter gestures                                                        | Balanced parameter gestures through the host                                |
| Saved settings | Host-owned VST3 state recall with the project; portable fit JSON remains an interchange contract             | Opaque state round-trip and fitted numerical interoperability               |
| MIDI           | Learnable controller bindings persisted with plug-in state                                                   | Recall and sample-offset processing                                         |

## Editor acceptance

Heron's native editor places the frequency graph between compact bars.
Selected-band controls stay at the lower center of the graph, keeping their
position and widget identity stable during edits.

The editor must keep these properties at its 1040 by 700 minimum size:

- The graph remains the primary work surface with no persistent inspector,
  output-settings column or 24-button band bank.
- Deselecting every band removes the band controls. Selecting a band shows a
  compact panel no wider than approximately 500 pixels, fixed at the lower
  center of the graph, with frequency, gain and Q immediately available. Moving
  a node must not reposition the panel or change its widget identity.
- Shape and channel placement stay with the selected-band controls. Low Cut,
  High Cut and Band Pass also expose their roll-off in dB/oct.
  Additional band actions and MIDI learning open only on request.
- Processing mode, analyzer and output controls open from
  compact bar entries. Their panels remain anchored inside the window and close
  without modifying the current EQ.
- Heron's host handles undo/redo and saved plug-in settings. The native editor
  provides band copy/paste through its Tools and band-action menus.
- Common actions use vector icons with hover tooltips: top-bar Tools ellipsis;
  footer power and analyzer bars; band headphones, trash and more actions. Processing mode,
  shape, channel, units and output dB/% values remain visible text.
  Active icons are highlighted; disabled actions are dimmed and do not publish
  messages. Trash and panel-close icons have distinct meanings.
- Curves and nodes remain readable with 24 bands. The graph has no persistent
  capacity-limit prose, and axis labels must not overlap. The selected band has a clear
  visual identity without permanent frequency and gain readouts on every node.
- Spectra and controls belong only to the current instance. Pre/Post measure its
  input/output; External and Match use its routed sidechain.
- Numeric editing and advanced panels must not clip their fields or make the
  underlying graph's band controls inaccessible.
- Operation feedback uses one optional, closeable notice, never a copy in every
  menu or numeric field. Close or Escape dismisses it; another menu or a new
  Match clears the previous notice. Dismissal does not write parameters or end
  an active host edit.

For native-scaled editors, the host retains mouse client coordinates when the
window changes size; the plug-in owns layout and content-scale conversion.
An asynchronous resize must not introduce an old-size/new-size input ratio
that survives after the new layout is drawn. Windows forced-size coordinate
remapping is reserved for the platform-scaling fallback, whose existing mapping
must remain valid when the accepted child size is unchanged.

Sidechain Match validates its candidate at the current sample rate before
committing settings and resetting selection. Failure retains all bands, output
settings, selection and any existing gesture, with no parameter apply or host
edit termination. This is failed-operation atomicity, independent of host undo.

Screenshot evidence is reviewed for these relationships and control discovery,
not just for absence of overflow. Rendering proves the displayed state;
gesture tests separately prove selection, editing, dismissal and host edit balance.

## Algorithm conventions

The analysis fitter and the native Zero Latency processor share digital
biquad Bell/LowShelf/HighShelf coefficients. A fitted preset uses one RBJ section
per fitted band, the unchanged frequency, gain and Q, and an independent output
gain. Its stored `slope_db_oct: 12` selects that single-section configuration;
it does not describe a Bell's asymptotic roll-off. `tests/fixtures/fit-preset.json`
and `fit-response.json` are the common renderer/native numerical contract at
48 kHz.

The native editor displays dB/oct only for Low Cut, High Cut and Band Pass.
Bell, shelf, notch, tilt and all-pass controls omit that label. Their existing
stored slope fields remain compatible with native presets. Bell, shelf, notch
and all-pass use `ceil(slope / 12)` sections; Tilt Shelf uses that many shelving
pairs, while Flat Tilt uses a fixed bank of eight shelving pairs. Hiding an
inapplicable label must not reset that field or silently change the audio of a
recalled preset.

Natural Phase uses two-times oversampling with 33-tap reconstruction and
antialias filters. Linear Phase uses a symmetric FIR and 256-sample partitioned
convolution. Its five resolutions use 513, 1025, 2049, 4097 or 8193 taps; latency
is half the tap count plus the convolution partition. The Brickwall setting is
a finite FIR approximation, and the editor must display that actual transition.

Preparing a new FIR leaves the current processor running. The callback warms
the new processor before a 10 ms crossfade and transfers the old owner to a
bounded retirement slot. Equal-latency edits are aligned; a mode change blends
each warmed path at its own latency, and host PDC changes at the owner handoff.
This transition can mix phase/delay characteristics temporarily. Callback
allocation, deallocation and blocking locks remain forbidden.

IIR edits arriving during a running 5 ms fade coalesce into one latest target,
which starts after that fade completes. Accepted audio metadata describes the
installed target while the editor preview shows current edit intent. This queue
uses fixed-capacity storage with no audio-thread allocation or locks.

All EQ bands use static filters. Global bypass crossfades to dry audio delayed
by the currently reported total latency.
Its histories continue running, including during bypass. Pre/Post spectra are
captured on the outside of this complete processing path.

The static response preview follows the editable target immediately in Zero
Latency and Natural Phase, even when no new audio samples arrive. Linear Phase
uses its exact finite FIR from one editor-owned worker, separate from audio
preparation. Its latest-only request and completion slots are bounded, and only
the current generation may be displayed. Kernel design runs outside the UI
thread and audio callback. The total curve is withheld while that target is
pending or failed; neither a stale kernel nor an ideal FIR replaces it. Trim,
pan and mute respond immediately using the cached kernel. Automatic gain keeps
the latest measured compensation until new audio arrives. Worker ownership and
closure are recorded in [ADR-0029](adr/0029-native-heron-eq.md).

The preview describes edit intent, while audio still owns the accepted processor,
reported latency and actual processing status. Pre/Post remain measured audio.
Solo audition uses measured Post spectra instead of an asserted static total
transfer. Display smoothing, channel projection and tilt
do not change the raw spectra used as matching targets.

The display applies a 1/6-octave FWHM Gaussian to power on the log-frequency
grid after temporal smoothing. Continuous power interpolation removes repeated
low-frequency FFT-bin steps; wider cells retain peak sampling. Bounded cubic
segments round the displayed trace without inventing extrema. The display uses
only this instance's captured audio. Match and collision detection use its raw
sidechain measurements, independent of display channel and tilt. Pre is a thin gray trace, Post has a light
filled trace, and the right dBFS axis is separate from the left EQ-gain axis.

Output L/R balance and M/S balance are separate persisted modes. A real 2x2
audio matrix smooths changes over 5 ms; true mono leaves that matrix neutral.
The preview composes the current target matrix with its prepared complex EQ
matrix before channel projection. Output mute supplies true zero amplitude
without replacing the fitter's finite gain convention. The
latency-compensated global bypass still returns the original dry signal.

Copying selected bands uses the validated portable envelope; pasting assigns only free stable IDs
and retains serial order and destination globals. Capacity or current-sample-rate
failure leaves every destination band and selection unchanged. Bulk writes keep
the last coherent audio configuration until the publication epoch completes.
The portable decoder ignores the legacy top-level `character` field; unrelated
unknown envelope fields remain invalid. Global automation ID 6 is reserved,
and every static parameter retains its identity.

Heron's implemented persistence captures opaque VST3 component/controller byte
chunks and restores them with the project. Portable fit exports use
`{ "format": "heron-eq", "version": 1, "config": EqConfig }` with static bands
and no dynamic-processing fields; they are not
VST3 state chunks, and there is currently no host importer for the full portable
preset. The native Tools menu's clipboard icon (Paste bands) already parses that envelope
and appends its bands without applying its global settings. The fit workflow is
to copy the full exported JSON, open the top-bar ellipsis and use Paste bands in a new empty Zero Latency
instance, then separately set its output gain to Overall Gain. A zero-band flat
fit needs only the gain setting and skips Paste bands. Frequency, gain, Q and
overall gain retain their numerical contract; band paste preserves the
destination's mode and output settings rather than replacing the whole preset.

## Verification commands

Use the repository-managed toolchain from a PowerShell 7 login shell on Windows.

```sh
mise exec -- cargo test -p heron-dsp-core eq::
mise exec -- cargo test -p heron-eq --features rt-paranoid
mise exec -- cargo clippy -p heron-dsp-core -p heron-eq -p heron-audio-host --all-targets --features 'heron-eq/rt-paranoid,heron-audio-engine/bench-internals' -- -D warnings
mise exec -- cargo truce build -p heron-eq --vst3 --debug
mise exec -- cargo build -p heron-vst3-host --bin heron-vst3-probe
mise exec -- node apps/desktop/scripts/builtin-vst3-smoke.ts
mise exec -- cargo test -p heron-eq --test vst3_bundle -- --ignored --nocapture
mise exec -- cargo test -p heron-eq --features rt-paranoid --test vst3_resize -- --ignored --nocapture
mise exec -- cargo test -p heron-eq --lib render_fit_and_full_native_editors -- --ignored --nocapture
mise exec -- pnpm --filter @heron/desktop check
mise exec -- pnpm --filter @heron/desktop exec playwright test e2e/plugin-analysis-eq-fit.spec.ts --workers=1
```

The probe must inspect the built bundle, including class identity, layouts,
sidechain/event buses and native editor support. Rendering alone does not prove
live-window mouse routing or hardware audio. Browser evidence must retain the
reported Chinese result-area regression, preset export and cancellation.

The packaged response test drives the actual DLL through Heron's VST3 host in
mono, mono-to-stereo and stereo, and compares seven measured sine responses
against the shared fitting fixture. The probe reads actual event bus counts;
an effect category does not imply absence of MIDI input. The manual render test
produces empty, three-band, selected-band, 24-band, numeric-entry and
bar-panel scenes from actual processor-fed telemetry at normal and minimum
window sizes. The files and dimensions are recorded in `out/eq-native/scenes.json`.
The same render pass inspects the real widget layout through semantic container
IDs. It checks the 44-pixel top bar, 40-pixel footer and remaining graph height,
and records the measured rectangles in `out/eq-native/layout-bounds.json`.
These bounds come from the editor's complete widget tree, rather than a separate
test composition or the PNG's dimensions.
The render pass also exercises actual Float overlay events and retained widget
state during Gain dragging, including repeated stationary pointer positions and
secondary menu changes. Separate regressions must cover immediate previews
without audio, stale FIR rejection and Match failure/dismissal without parameter
changes.

The `vst3_resize` regression uses live native Windows attachments at actual
per-window DPI with 100% and 125% host zoom. The negotiated VST3 view and child
HWND must have the same physical extent. It grows, shrinks and repeats the
accepted logical size (1120 × 760 → 1500 × 950 → 1040 × 700 → 1120 × 760),
checking actual mouse hits on bypass, curve nodes and the Gain rotary. It also
changes zoom on an attached view and checks Escape cancellation, focus loss
and closure during parameter gestures. The fixed-version toolkit patches and
their provenance are recorded in the producer's `third_party/truce-gui/PATCHES.md` and
`third_party/baseview-truce/PATCHES.md`; the native focus-loss event bridge is
recorded in its `third_party/truce-iced/PATCHES.md` for
[issue #220](https://github.com/minori-live/heron/issues/220).
The narrow host regression reproduces the
old implementation's input drift and verifies native identity, retained platform
fallback mapping and replacement-child coordinates after the fix.
Same-cache GPU evidence separately retains the native widget tree across
1120 × 760 → 1440 × 980 → 1040 × 700, checking painted controls, relocated
button hits, Gain changes and floating-menu dismissal. Its 18 event frames and
five GPU screenshots are recorded in `out/eq-native/resize-hit-frames.json`;
it cannot establish the host's HWND coordinate mapping alone.

## Compatibility boundaries

Verification covers Heron's mono, mono-to-stereo and stereo VST3 layouts and its
versioned static-band interchange. Each editor operates on one plug-in instance.
Measured spectra, static previews, processing status and reported latency have
separate contracts; a plotted curve does not establish actual audio behavior.
Local editor closure revokes its host bridge, balances gestures and clears only
its generation's solo ownership. This is verified against Heron's queued callback behavior;
arbitrary external hosts that destroy an editor reentrantly inside a parameter
callback need separate lifecycle validation. Additional plug-in formats and
control-surface integration are outside the current VST3 host contract.
The locked Truce wrapper coalesces host automation into sub-blocks of at least
32 samples. MIDI CC handling retains event offsets inside the native processor,
but arbitrary host parameter offsets do not establish one-sample automation
precision. The packaged test checks output-gain causality at a 32-sample boundary.

The fitter's quota is an upper bound, not an exact count or an optimality
certificate. Its default remains three bands and search remains cancellable.
Fit exports describe magnitude filters at the selected sample rate; they cannot
reconstruct phase, delay, nonlinearities or the source plug-in's channel routing.
