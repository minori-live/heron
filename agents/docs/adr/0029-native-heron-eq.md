# ADR-0029: Native Heron EQ and fitted-preset interchange

- Status: Accepted
- Date: 2026-10-07
- Owners: project maintainers
- Scope: native processor/editor ownership, 24-band compatibility, preset interchange;
  plugin feature verification is recorded in [the producer's EQ notes](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/heron-eq.md),
  and host/fitting acceptance in [Heron's integration notes](../heron-eq.md)
- Related: [ADR-0001](0001-runtime-ownership-and-transactions.md),
  [ADR-0025](0025-plugin-analysis-eq-fitting.md)

## Current ownership

[ADR-0031](0031-artifact-delivered-built-in-plugins.md) moves the EQ DSP,
parameters, editor and toolkit patches into `heron-plugins`. Heron retains its
embedded host, fitting/export workflow and artifact integration tests. The
processing, state and interaction contracts below remain in force.
The producer maintains their current implementation rules in its local
[architecture](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/architecture.md)
and [EQ notes](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/heron-eq.md).

## Context

The analysis fitter uses digital Bell and shelf filters with an explicit Q
convention and frequency-response contract. Users need to hear the fitted result,
edit it visually and inspect the actual input/output spectra. Heron EQ provides
direct graph editing with Heron's static processing algorithms and a maximum of
24 bands per instance. Functional completion is checked per feature against its
specified audio and interaction behavior. The contract excludes Dynamic EQ and
local drawing/history controls.

## Decision

Heron EQ is a bundled native Truce VST3 effect, following the existing Gain and
instrument packaging path. It runs inside the embedded host and has an Iced
editor. It introduces neither a helper process nor a general renderer/native
API. Runtime-independent filters, response evaluation and prepared processors
belong to `dsp-core`; VST parameters, native editor and telemetry belong to the
plug-in. The editor uses the same transfer evaluator as audio processing.

Each instance exposes 24 stable parameter slots. Adding/removing bands changes
slot presence; deleting one slot never renumbers the others. Presence and band
bypass are distinct. Automation and saved plug-in state retain their usual
host ownership. The stable plug-in identity is `live.minori.heron.eq`.
An independent order parameter retains the serial order of mixed Left/Right and
Mid/Side filters; stable slot identity does not imply processing order.
Native editor parameter/group writes use one odd/even publication epoch. The audio
callback keeps its previous coherent configuration while a bulk write is in
progress, without taking the editor's writer lock. Semantic validation precedes
any replacement of the active static or output settings.

Bands contain only static filter settings. Dynamic EQ and spectral dynamics are
retired; their former automation offsets remain reserved gaps rather than being
reused for different controls. Static global IDs and band IDs retain their
ownership. Undo/redo is handled by the host, and ADR-0030 fixes selected-band
controls at the graph's lower center.
The output Character stage and its editor controls are retired. Its global
automation ID 6 remains reserved; other global IDs retain their assignments.

The audio callback must not allocate, free prepared processors, plan FFTs,
touch files/clipboard, lock against a control thread, or wait for preparation.
Sample telemetry uses a bounded nonblocking handoff and explicitly reports lost
samples. Spectrum calculations happen outside the callback. Pre and Post refer
to actual audio on either side of all EQ/output processing; the response curve
cannot substitute for a Post spectrum. External spectrum/detection uses the
explicit sidechain bus.
The native editor displays only its own instance's Pre/Post and sidechain audio.
EQ Match uses that sidechain as its measured reference.

Modes that need new FIR/FFT state prepare it in a plug-in-owned worker in the
same process. Publication and retirement are bounded; stale generations cannot
replace newer requests. The previous processor remains active while preparation
is pending or fails. The callback publishes an accepted prepared processor at a
block boundary and hands obsolete state back for destruction outside the callback.
Reported latency always describes active processing, and the host receives
latency changes for delay compensation. Editor closure must not stop active
audio, and plug-in destruction must retire its worker/resources.
An invalid reset at a new sample rate has no reusable previous processor: it
publishes a transparent fallback, its actual flat response and a preparation
error rather than exposing stale curves or latency from the previous rate.

IIR edits arriving during a running 5 ms fade coalesce into one latest target,
which starts after that fade completes. Accepted audio metadata describes the
installed target while the editor preview shows current edit intent. The queued
target uses fixed-capacity storage with no audio-thread allocation or locks.

The editor also owns one response-preview worker, independent of audio
preparation. Zero Latency and Natural Phase previews evaluate the current
static edit intent directly. Linear Phase previews prepare that intent's exact
finite FIR outside both the UI thread and audio callback. A latest-only request
slot and completion slot bound retained work; generation checks discard obsolete
results. Pending or failed preview work cannot display a stale kernel or an
ideal response in its place. Trim, pan and mute reuse the cached FIR without
starting another kernel design. The worker owns immutable settings and response
data, never the host bridge. Preview destruction cancels publication and wakes
the worker, then joins it outside the publication lock before the native DLL
can unload. Closure may wait for one in-flight kernel design; response-grid
evaluation checks cancellation between frequency points. Worker resources are
reclaimed outside the callback.
Preview completion does not adopt an audio processor, change reported latency or
override audio's accepted configuration and processing status. Interaction and
notification behavior are specified in [ADR-0030](0030-eq-graph-and-floating-controls.md).

The earlier live-instance discovery, cross-instance spectrum/reference and
cross-editor editing contract is retired. Native editors have no instance
directory or remote editor bridge. Band clipboard transfer remains available;
it transfers explicit settings without displaying or controlling another live
plug-in.

Each native editor retains a local revocable session for its own host bridge.
Synchronous editor closure revokes that bridge before asynchronous window
teardown, balances open gestures and releases its generation-bound solo audition.
A delayed window destruction can release only that window's ownership; it cannot
revive its host context or stop a newer editor's audition. Heron's host callbacks
enqueue bounded work and do not close an editor inline.

Portable presets use a JSON envelope with `format: "heron-eq"`, `version: 1`
and an explicitly validated static-band `config`, without dynamic-processing
fields. Legacy JSON's extra dynamic fields do not enable processing. The portable
decoder ignores only the retired top-level `character` field before enforcing
the strict envelope; new exports omit it. Optional output settings have documented
defaults. Unknown versions, nonfinite values, duplicate/out-of-range identities,
more than 24 bands and unsupported combinations fail before replacing settings.
The native editor uses the clipboard only for band copy/paste and has no file
preset interface. Preset management and A/B comparison belong to the host, as
recorded in [ADR-0030](0030-eq-graph-and-floating-controls.md). The text-only
`arboard` dependency supplies band clipboard operations because the embedded
Iced adapter does not implement its clipboard tasks; Wayland data-control
support is enabled. Clipboard failure leaves settings unchanged.

The EQ Fit window keeps its narrow read-only preload authority. It can show a
portable preset for the user to copy, but cannot insert, replace or mutate an
ambient project plug-in. Fitted Bell/LowShelf/HighShelf sections map to native
bands with a slope setting of 12 in Zero Latency mode with unchanged Q, frequency
and gain, and
an independent output gain. Same-sample-rate equivalence is an explicit tested
contract. Exported presets do not reproduce cross-channel routing, original
phase/delay/nonlinearity or unresolved frequencies.

This record supersedes only ADR-0025's eight-section ceiling and absence of
portable export: the fit quota now accepts 1 through 24. Its default of three,
raw-bin magnitude target, worker cancellation, source identity and invalidation
rules remain applicable. Quota is an upper bound, not a request for exactly that
many filters. Search remains bounded and cancellable; higher quotas can cost
substantially more and do not certify an optimum.

## Alternatives rejected

- Passing fit settings to arbitrary live instances from the read-only fit
  renderer would require a new explicit resource/revision transaction. Portable
  interchange fits the present authority boundary without implicit targets.
- Implementing a separate browser audio EQ would duplicate the DSP model and
  host lifecycle, with avoidable disagreement between plotted and audible curves.
- Renumbering visible bands would redirect existing automation after deletion.
- Treating a transfer curve multiplied by an input spectrum as measured Post
  would conceal nonlinear, channel and latency behavior.
- Doing FIR preparation or spectrum analysis on the callback would introduce
  unbounded work and allocations.

## Consequences

Native and fitted settings share an inspectable numerical convention. Increasing
the number of bands has bounded state/memory but raises processing and fitting
costs. Native modes and fractional slope controls use Heron's own algorithms;
numerically matching another product's displayed Q or mode names is not promised.
Processing modes require their own audible/interaction evidence before
they count as complete. Cross-instance display and editing are outside the native
editor's current contract. Host multichannel support is a separate
architecture requirement, not satisfied by stereo mid/side controls.

## Verification

Verify fitted-preset interchange against shared normative response fixtures;
impulses/sines, channel projections, filter stability, mode latency and parameter
transitions; callback allocation/retirement and queue pressure; real Pre/Post and
sidechain samples; 24-band add/delete/group gestures and stable automation;
portable codec validation and band-paste rejection before mutation; host plug-in
state restore and interchange; actual native editor
rendering; and packaged VST3 identity, layout and editor probing. Fit-window
browser tests retain both Chinese/English result visibility and cancellation.

## Reconsider when

Live fit application needs a transaction, a preset incompatibility needs a new
version, multichannel hosting is introduced, or measured resource limits require
changing the preparation/telemetry design or 24-slot compatibility commitment.
