# Architecture and real-time constraints

Heron is an Electron application with one native audio runtime embedded in the
Electron main process.

```text
Vue renderer
  -> typed window.heron preload API
  -> Electron main RPC handlers and application services
  -> @heron/dsp-node (.node dynamic library, same process)
       -> embedded Rust control runtime
       -> audio engine and cpal streams
       -> format-neutral AudioPlugin runtime
            -> VST3 adapter and ARA sidecar
            -> CLAP adapter
       -> direct telemetry and bounded parameter queue
```

There is no `heron-audio-host` executable, audio-host client addon, OS IPC
channel, shared-memory arena, watchdog, or helper restart coordinator. The
renderer/main Electron boundary remains a real process boundary; the
main/native boundary is N-API within one process.

## Ownership

- Renderer owns presentation and user intent. It never imports native addons.
- Preload exposes the narrow typed `window.heron` API.
- Electron main owns resource validation, project state, native runtime
  lifetime, and application policy.
- `@heron/dsp-node` owns `EmbeddedAudioHost`, its bounded Tokio control queues,
  audio engine, AudioPlugin actors, and telemetry.
- The audio callback owns only real-time-safe state. It must not perform N-API,
  Electron IPC, filesystem I/O, allocation, logging, or blocking locks.

## Built-in plug-in dependency

`heron-plugins` owns the Gain, Sine, Metronome and EQ sources, native UI,
EQ DSP and format exports. Heron retains its runtime, host, metronome scheduling
and tests that exercise the host against prepared VST3 bundles. Builds prepare
an immutable producer release pinned by suite version, source commit and runtime asset filenames, while
the installed manifest supplies the inventory and probes establish capabilities.
A missing bundle remains unavailable with its saved state intact. See
[ADR-0031](adr/0031-artifact-delivered-built-in-plugins.md) and
[the distribution contract](builtin-plugin-distribution.md).

## Dependency contracts

The process diagram is also a dependency direction. Imports and runtime calls
must point toward an owned contract, never around it.

```text
renderer presenter <- props / intent -> renderer controller or store
renderer controller or store -> typed preload API -> main IPC handler
main IPC handler -> application service -> project DB and native adapters
native adapter -> @heron/dsp-node -> embedded runtime -> audio callback
```

- Presenters do not read stores, routing, Electron, the project database, or
  `window.heron`.
- Preload adapts the narrow API but owns no application policy or durable state.
- IPC handlers validate, authorize, resolve explicit resources, and delegate;
  application services own workflows and commit points.
- `@heron/contracts` contains serializable boundary types and depends on no UI,
  Electron, persistence, or native implementation.
- `@heron/project-model` owns pure project invariants.
- Mixer invariants and its persistence projection are independent of Studio
  tracks, clips, and musical maps; Studio adds its own ownership and timeline
  validation to the shared Mixer model.
- `@heron/project-db` is the only project persistence implementation.
- `@heron/ui` owns shared visual behavior and accessibility, never product state.

Studio and Live use separate document sessions and PGlite workers over a shared
Mixer independent of Studio tracks/clips/media. Live currently owns revisioned
Project, Set/Patch scalar and complete-state editing, recovery, Perform activation
and selective Capture. Editing selection is independent from audio activation;
Edit is silent. Native instance generations, graph receipts and a bounded cut
transition govern activation. [Live documents](live-documents.md) owns the full
current contract and distinguishes implemented scope from accepted future design.
[The roadmap](roadmap.md#current--live-project-delivery) owns outstanding delivery
and native/hardware/soak evidence.

Both document views compose the presenters in `components/workspace`:
`DocumentWorkspaceShell`, `WorkspaceTopbar`, `WorkspaceControlGroup`,
`WorkspaceControlButton`, `WorkspaceMasterControl`, `WorkspaceStatusbar`, and
`WorkspaceSidePanel`. The side-panel container owns resizing, cancellation,
keyboard gestures, and width limits; each view supplies its width preference
and responsive bounds. Studio's leaf adapters provide telemetry and display
settings to the shared Master/quick-gain presenters, keeping meter updates local.
File commands use the application menu and shortcuts in both workspaces.

Live puts `MixerSurface` in the resizable right column
and reserves its center for a future custom performance layout. The Studio
Mixer adapter and Live Mixer controller share the original strips and controls;
Live supplies document commands, exact hardware choices, and runtime meters
only during Perform. Creating a Live channel never calls Studio track creation. Device/MIDI
configuration uses a draft dialog and does not mutate global audio preferences.
Audio settings presenters own their layout and styles; document controllers
retain their distinct device-selection policies. Mixer deletion and instrument
replacement use shared confirmation decisions; eligibility checks and mutations
remain with the owning document controller.

Detailed code and review rules live in
[Engineering standards](engineering-standards.md).

## Stateful workflow contract

A stateful operation that crosses renderer/main or main/native boundaries must
define its states, explicit resource handles, generation/revision behavior,
single commit point, prepare/abort cleanup, failure data state, and idempotency
or operation-status reconciliation. The renderer receives a serializable typed
result and a documented recoverable or quarantined state.

Completion order is not authority. When automatic recovery competes with a
newer user mutation, an explicit generation determines which result may commit.
See [device recovery](product-live.md#device-recovery-concurrency) for user-choice
precedence and [command admission](#project-command-receipts-and-admission) for receipts.

Every workflow with these properties includes state-machine or state-table
tests. A timeout must not manufacture a failure response when a dispatched
mutation can still commit.

Project commands read their result inside the SQL transaction. Their retained
response transfers from the database worker to main, then is released after
renderer acknowledgement; results are not indefinitely retained per edit.
Unknown commit outcomes quarantine the graph until an authoritative workspace
is re-established. See [command receipts](#project-command-receipts-and-admission).

## Native control and UI events

Plugin Analysis owns a secure auxiliary renderer and two independent volatile effect
chains. Original and measurement instances share the embedded host, with a bounded
analysis worker and revision-guarded report publication. It does not claim an
audio device. See [Plugin Analysis](plugin-analysis.md) for session lifetime and measurement
limits.

Plugin Analysis plots use the shared `@heron/ui` ECharts adapter, loaded when a
plot mounts. Numeric and logarithmic curve axes retain the report's measured
coordinates and gaps. The 2D spectrogram uses custom Cartesian cells with a
continuous color scale; hover readouts report the FFT window's time, pooled
frequency band and original peak dBFS. Zoom and pan change display domains only.
The component owns chart resizing, theme-token resolution and disposal.

Electron main sends MessagePack request envelopes to the addon to preserve one
typed Rust protocol and one response-validation path. This serialization is a
local N-API ABI, not an IPC transport. Binary payloads are inline; attachment
descriptors and shared-memory references are rejected.

The addon places control work on bounded in-process channels. N-API async tasks
wait outside the JavaScript thread. Parameter automation uses a separate
bounded direct queue, and telemetry is read directly from the engine snapshot.

Plug-in control and editor calls remain thread-affine. Tokio queues them on a
bounded mailbox and wakes Electron main through a non-blocking N-API
threadsafe function. Electron drains at most one bounded batch per turn and
owns the platform application loop; the embedded runtime never creates or
pumps a winit event loop. Electron `BaseWindow` owns each native plug-in editor
surface and a sandboxed `WebContentsView` toolbar; Rust attaches the platform
native view below that toolbar and returns resize/state requests through a
bounded queue drained by Electron main. Windows uses a borderless owned native
popup so plug-in OpenGL rendering remains independent of Chromium composition;
native owner notifications synchronize its position and visibility. See
[editor surfaces](native-call-boundary.md#editor-windows-and-platform-surfaces).

## Audio plug-in formats

`heron-audio-plugin` owns the format-neutral block processor, process context,
events, stable audio-port and parameter keys, and temporary real-time tokens.
`audio-engine` and `dsp-render` depend only on this crate; concrete plug-in
formats must not leak into either render graph.

The control plane identifies a plug-in by `{ format, artifactPath, nativeId }`.
Projects persist opaque state chunks and audio side-chain port keys. Strings are
resolved to bounded numeric tokens before graph publication, so the callback
never performs string lookup. VST3 maps bus and parameter IDs into this model;
CLAP uses its native IDs. ARA remains a VST3-only sidecar.

Project audio modes describe the channel-strip signal contract, independently
of a processor's native bus layout. A proven native 1-in/2-out layout provides
`mono-to-stereo` directly. A processor with only a proven 1-in/1-out layout can
provide the same host mode through an explicit format-neutral post-process
adapter that copies left output to right without callback allocation. Native
layout probing remains isolated; the embedded runtime never retries a layout
that the probe did not validate. See
[containment](#graph-publication-and-plug-in-containment).

Before runtime loading, isolated capability probes target the selected native
identity, and main caches results by the complete plug-in locator. Other classes
in the same artifact do not participate in that selection's deep inspection.
Catalog enumeration retains its full-artifact scope. See
[selected capability probes](native-call-boundary.md#selected-capability-probes).

`heron-clap-host` is the only owner of CLAP unsafe FFI and depends directly on
the pinned `clap-sys` version. It separates a main-thread, `!Send + !Sync`
control instance from a `Send + !Sync` audio endpoint. Factory probing occurs
in `heron-clap-probe`; live processing remains embedded in Electron main.
Timer callbacks and Unix POSIX-FD readiness are polled from the existing
UI/control heartbeat and never from the audio callback. Restart and parameter
or port rescans publish a temporary processor-less graph, explicitly stop the
old endpoint on the audio thread, wait for its lease to return, reactivate on
the control thread, then publish the replacement endpoint. A failed
reactivation leaves the committed project intact and the live graph bypassed.

### Built-in plug-in integration testing

CI uses the pinned released Heron plug-ins for host integration. The
cross-platform `test:builtin-vst3` task checks the four plug-ins' native
identities and capabilities, historical state restoration, Gain processing in
a live graph, and EQ integration. Linux additionally runs instrumented
`test:plugin-analysis` with Heron Gain to exercise state cloning, parameter
replay, processing and report mapping. The Linux Electron end-to-end suite
opens independent native Gain editors.

CI no longer builds or runs Steinberg VST3 or free-audio CLAP example plug-ins.
Their local diagnostic scripts remain available. The VST3 SDK remains a
production host build dependency. Real plug-in tests establish the exercised
Heron integration, not general plug-in or SDK conformance.

The Heron plug-in suite is the basis for future AU, AAX and CLAP integration
coverage. Current host CI consumes VST3 bundles only; those additional formats
need their own released artifacts and host checks before they provide evidence.

## Failure model

An unrecoverable native crash terminates the Electron main process; it cannot
leave a live renderer talking to a dead audio helper. Ordinary request errors
remain typed results and do not destroy the runtime. Heartbeats provide
diagnostics only and never trigger graph/plugin/transport reconstruction.

Embedded control requests wait for terminal actor results. Slow-request
thresholds drive logs and diagnostics but never cancel already-dispatched work
or manufacture a timeout result with an unknown mutation outcome.

Runtime worker limits are saved as preferences and applied on the next
application launch. Heron deliberately does not tear down and recreate the
embedded audio runtime in a live process.

Rust production paths return typed `Result` values for device, plug-in,
filesystem, input, and protocol failure. Runtime input is not handled with
`panic!`, `unwrap()`, or unexplained `expect()`. Panic must never unwind through
N-API, a plug-in ABI, a platform callback, or the audio callback. A callback
reports failure through bounded state, counters, or a non-blocking control
signal; it does not recover in place.

## Real-time rules

- Keep callback work bounded and allocation-free.
- Use lock-free snapshots or bounded non-blocking queues at callback edges.
- Build graphs, load plug-ins, access files, and encode responses off callback
  threads.
- Never hold a callback-visible lock across N-API, Electron, device, plug-in,
  or filesystem calls.
- Overflow and stale-generation outcomes must be explicit and observable.

## Project command receipts and admission

SQL mutation and resulting snapshot decoding share one database transaction;
snapshot failure rolls back the write. A retained prepared token therefore means
no commit and permits abort. The worker retains committed results for token replay.
Main retains its terminal response before acknowledging the worker; a failed
acknowledgement is retried by the next command and cannot make a known commit
unknown. A replaced project handle discards old tokens. Renderer adopts/rejects
a known result before acknowledging main; later graph interactions retry failed
acknowledgements. Main-originated sidechain edits acknowledge their own results.

Unknown results remain retained and the graph quarantined until an authoritative
workspace is re-established; reopening creates a fresh workspace. Given mutation
identity and a complete target generation, replay lookup precedes fresh-work
body/revision/lifecycle checks. Operation-ID reuse requires the same idempotency
key and target. A target-scoped key can replay the original under a different
operation ID; one operation ID cannot cross resource generations.

Saving retains the workspace and allows project-backed work. Closing owns teardown
synchronously and closes main-side admission; renderer admission is only a UX gate.
Close drains already admitted work before state synchronization and teardown.
Low-latency configure reserves its graph queue in admission order before revision
and asynchronous preflight checks, retaining ownership through publication,
resource advancement and terminal response retention. Rejected fresh work during
close creates no operation record.

Acknowledgement ends replay eligibility. Terminal/quarantined records remain for
acknowledgement or reconciliation within bounded retention. Timers, arbitrary
eviction and larger limits cannot replace ownership transfer. Typed domain errors,
not message wording, select retry/outcome semantics. Other domains define their
own receipt lifetime, such as [updates](application-updates.md#receipts-and-recovery).

## Graph publication and plug-in containment

One prepare/activate/abort protocol owns document graphs. Candidate processors
remain separate from the active registry, retain compilation ownership until
commit/abort, and respect outstanding processor leases during destruction.
Known not-committed activation failure aborts the candidate; cleanup failure logs
both errors without replacing the activation outcome. Unknown activation is
reconciled, never speculatively aborted or reported as still prepared after its
instances have been consumed.

Internal refresh coalesces to one latest pending snapshot and cannot supersede
a document candidate or block the UI mailbox/engine actor while awaiting ownership.
One off-callback compilation path serves both. The background actor continues
serving device queries. With stopped audio, parking the graph in pending state
commits publication; running audio additionally requires callback acknowledgement.
Retry creates a replacement generation from committed state. Old parameter,
editor, ARA, latency, tail and graph results cannot publish into that generation.

Containment covers returned failures and safely validatable data in initialization,
bus activation, restore/save, processing, bounded output, parameters, editor/ARA
lifecycle, queue pressure and stale generations. It cannot contain access
violations, memory corruption, aborts, deadlocks or non-returning calls. Never
catch panics in the audio callback or promise audio continuity after a fatal crash.

Failed instances retain project slot, identity, routing, alias, creative bypass
and committed bytes. Effects emit delay-aligned dry audio; instruments emit
silence while loading, bypassed, failed or quarantined. Only successful processing
and bounded output validation make output audible. Callback failure emits at
most one bounded signal per transition.

Runtime states are unloaded, loading, active, bypassed, failed and quarantined.
Typed failures carry category, stage, outcome, retry eligibility, generation,
graph revision and diagnostic ID. Explicit Retry/Keep Bypassed replaces automatic
re-enabling. Repeated failures quarantine the artifact fingerprint/native ID;
a changed fingerprint is eligible for explicit retry. Load/restore publishes only
validated replacements; state-save failure preserves committed bytes; uncertain
editor detach or ARA ownership quarantines the affected resource.

Device loss immediately presents recovery choices while bounded reconnects
continue. A committed explicit choice owns the authoritative generation. The
original device may resume first, but the dialog remains available and the later
choice wins. Candidate refresh preserves focus and draft selection. See
[the performance contract](product-live.md#device-recovery-concurrency).

## Native wire model ownership

`dsp-runtime::protocol` owns native wire shapes and serialization. Resolved engine
state owns indices, tokens, processor handles and generations; real-time state
owns fixed arrays, atomics and rings. Do not duplicate serialized fields in a
parallel engine DTO or add serde to `audio-engine`. Resolved state must represent
an actual runtime distinction. `Native*` is reserved for napi DTOs in `dsp-node`.
This native boundary does not replace Drizzle's ownership of database schemas.

Generate and commit TypeScript declarations with `mise run codegen:wire-types`;
`mise run codegen:wire-types:check` checks drift. Do not hand-edit generated files.
Handwritten binary/telemetry adapters own behavior or tuple interpretation rather
than a second wire schema. [ADR-0011](adr/0011-protocol-owns-the-wire-shape.md)
retains the rationale for generation and distinct resolved state.

## Media audition

One control-plane audition can coexist with playback. Main validates/materializes
the project BWF and routes it to the graph's first stereo Output. Decode and
allocate off the callback; swap owned buffers through the command ring, mix into
prepared hardware outputs, and retire through a bounded ring for control-thread
destruction. Replacement, explicit/bounded-duration stop and engine destruction
release ownership. Audition does not move the playhead, change playback/recording,
create Undo, persist state or dirty the document.

## Decision governance

Update this document and the relevant feature documents when authorized work
changes current architecture. Explain the change and its validation in the PR.
Maintainers decide when a durable choice warrants a separate record under
[ADR governance](adr/README.md); touching an architectural boundary does not
automatically require one. Agents must follow that policy's explicit request
and acceptance rules. Proposed decisions are not current architecture.
