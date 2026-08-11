# Plug-in failure containment implementation plan

This plan refines the plug-in resilience work in the
[Current roadmap milestone](roadmap.md#runtime-resilience). It deliberately
keeps VST3, CLAP, ARA, audio processing, controllers, and native editor child
views inside the existing embedded runtime. It does not introduce a helper
process, OS IPC, shared memory, or a second application loop.

“Containment” here means that a plug-in or host operation returns, reports, or
otherwise exposes a failure that Heron can convert into an instance-level
failed/bypassed state. It does not mean that Heron can survive arbitrary native
code failure in the same process.

## Current implementation slice

The current branch implements returned process-call rejection and non-finite
audio detection. The processor enters a sticky failed state without another
third-party process call, effects restore the block's pre-captured dry input,
and instruments emit silence. A bounded typed event carries the failure to the
owning slot, where the user can explicitly retry. Retry currently re-arms the
still-owned processor; it does not unload the module, recreate ARA objects, or
claim a new instance generation.

Delivery Slice 1 is complete on this branch. Rust and TypeScript share the
category, stage, terminal-outcome, instance-generation, and graph-revision
contract. Strict Rust and Electron-main decoders reject malformed or ambient
fields, and cross-language MessagePack fixtures lock the named encoding. The
feature-gated fixture harness deterministically rejects every returning stage,
maps every category to one terminal outcome, and converts only an unwind-safe,
host-owned non-real-time fixture panic into `host-panic`.

Initialize, restore, parameter, editor, state-save, and ARA returning failures,
generation-based instance replacement, repeated-failure fingerprint
quarantine, notifications/health details, platform matrices, and soak evidence
remain later slices below. Consequently the parent roadmap outcome remains
unchecked until those exit conditions are met.

## Capability boundary

Heron can contain:

- module or instance initialization rejection;
- unsupported or rejected bus/layout activation;
- state restore/save rejection or invalid state data detected at a host-owned
  boundary;
- a VST3/CLAP process call that returns a failure result;
- invalid bounded output metadata and non-finite audio detected by host checks;
- parameter, editor attach/open/resize/detach, and ARA callback failures that
  return control to the host;
- bounded queue overflow, stale generation, and host-owned Rust panic at an
  explicitly guarded non-real-time boundary.

Heron cannot safely contain:

- access violations, segmentation faults, illegal instructions, native stack
  corruption, process aborts, or termination from third-party code;
- a plug-in call that deadlocks or never returns, because an in-process call
  cannot be preempted safely;
- corruption that escapes validation and damages unrelated memory; or
- panic recovery inside the audio callback as a substitute for maintaining
  panic-free real-time code.

Those fatal failures retain the ADR-0001 behavior: Electron main may terminate,
and relaunch uses the existing saved-versus-recoverable working-copy choice.
The UI and documentation must not call this process isolation or crash
protection.

## Product behavior

When a failure is contained, the affected slot stays visible with its plug-in
identity, failure stage, and recovery action. Other legal graph paths continue.
An effect uses delay-aligned dry audio; an instrument produces silence. Heron
does not delete the slot, alter its routing or control alias, or persist a new
creative bypass choice merely because the runtime failed.

Retry is explicit. A retry creates a new instance generation, restores only the
last committed state, and returns to a user-bypassed state before enablement.
Late results from an older generation cannot publish state, parameters, editor
events, ARA callbacks, latency, or tail changes.

## State model

The existing public runtime states remain the base vocabulary. Add structured
failure details rather than new free-form protocol semantics.

| State         | Audio behavior                           | Allowed next states                 | Authority                          |
| ------------- | ---------------------------------------- | ----------------------------------- | ---------------------------------- |
| `unloaded`    | Existing graph fallback                  | `loading`                           | Project graph generation           |
| `loading`     | Dry for effects, silence for instruments | `active`, `failed`                  | Instance generation                |
| `active`      | Plug-in output                           | `bypassed`, `failed`, `quarantined` | Published graph revision           |
| `bypassed`    | Delay-aligned dry or silence             | `loading`, `active`                 | Explicit user mutation             |
| `failed`      | Delay-aligned dry or silence             | `loading`, `quarantined`            | Contained failure event            |
| `quarantined` | Delay-aligned dry or silence             | `loading` after explicit retry      | Artifact fingerprint + user intent |

Extend `PluginRuntimeStatus` with a typed failure record containing at least:

- category: `plugin-rejected`, `invalid-output`, `host-panic`, `queue-overflow`,
  `stale-generation`, or `host-state`;
- stage: `initialize`, `restore`, `process`, `parameter`, `editor`, `state-save`,
  or `ara`;
- recoverability and retry eligibility;
- instance generation and graph revision; and
- a diagnostic ID for logs, without exposing an exception string as protocol
  semantics.

The existing human-readable `error` may remain display/diagnostic data, but
control flow must use the typed fields.

## Failure and commit rules

| Operation       | Commit point                                                | Failure result                                          |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Load/initialize | Replacement processor is fully prepared and graph-published | Keep processor-less/bypassed slot                       |
| Restore state   | Validated instance with restored state is graph-published   | Retain persisted bytes; mark instance failed            |
| Process block   | Completed output passes host validation                     | Use dry/silent fallback for the affected instance       |
| Set parameter   | Accepted by the current instance generation                 | Return typed stale/full/failed outcome; do not retarget |
| Open editor     | Child view attach is acknowledged                           | Close partial surface; audio may remain active          |
| Close editor    | Child view detaches before parent destruction               | Quarantine editor state if safe detach cannot complete  |
| Save state      | Validated bytes durably replace prior project state         | Prior committed state remains authoritative             |
| ARA update      | Current-generation callback is validated and applied        | Quarantine the ARA operation/instance as classified     |

Graph replacement remains prepare/activate/abort. A failure must never remove
the project slot or make an unrelated processor unavailable. If the host cannot
prove whether a stateful operation committed, it uses the existing quarantined
mutation outcome and reconciliation path rather than guessing.

## Delivery slices

### 1. Typed failure taxonomy and fixture harness — complete

- Define Rust and TypeScript failure category/stage unions and generation data.
- Extend MessagePack fixtures and strict decoders before adding UI behavior.
- Add deterministic built-in test fixtures that reject initialize, restore,
  process, editor, state-save, and ARA operations without invoking undefined
  behavior.
- Add a host-owned Rust panic fixture only for non-real-time boundaries guarded
  with `catch_unwind`; do not attempt to catch foreign crashes.

Exit: every supported failure maps to one typed terminal result, and malformed
failure data is rejected without changing graph or project state.

Evidence: protocol fixture tests cover all seven stages and six categories;
Rust rejects missing, unknown, and ambient failure fields; Electron main
rejects invalid generation, revision, outcome, recoverability, category, stage,
and extra fields. The pure fixture harness has no graph or project mutation
authority. Actual lifecycle call-site containment remains Slice 3.

### 2. Instance-level audio fallback

- Centralize processor-call outcomes in the format-neutral `AudioPlugin`
  boundary so VST3 and CLAP do not leak into the render graph.
- For returned processing failures, atomically mark the instance failed and use
  the existing bypass delay path for effects or silence for instruments.
- Add bounded validation for frame/channel/event counts and targeted non-finite
  output checks. Benchmark checks before enabling any full-buffer scan in the
  callback.
- Emit one bounded failure signal per state transition; do not log or allocate
  from the callback.

Exit: failure of one fixture instance preserves sample-correct unrelated paths,
PDC, side chains, meters, transport, and recording taps without callback
allocation.

### 3. Control, state, editor, and ARA containment

- Make initialize/restore/save and editor lifecycle return typed stage failures
  and complete prepare/abort cleanup.
- Guard host-owned Rust callbacks at safe FFI and actor boundaries so a Rust
  panic cannot unwind through N-API or a plug-in ABI. Convert only a caught,
  unwind-safe host panic to a quarantined result.
- Keep each ARA document/controller graph in the embedded runtime and add
  generation checks to queued callbacks, analysis progress, archive operations,
  content changes, and editor events.
- Preserve the strict detach-before-destroy ordering for native editor windows.

Exit: fault injection at every returning call site leaves either the previous
committed instance or an explicit failed/bypassed instance, with no leaked
editor surface or ARA object.

### 4. Recovery and user surfaces

- Present failed state on the owning plug-in slot and in health details; use a
  non-modal notification only when the failure newly occurs.
- Offer explicit Retry and Keep Bypassed actions. Explain when a fatal native
  failure cannot be contained in process.
- Keep project `enabled`, routing, control alias, and saved state separate from
  runtime failure state.
- Quarantine repeated contained failures by plug-in artifact fingerprint and
  native ID; a changed fingerprint is eligible for explicit retry.

Exit: localized, accessible renderer tests cover failure, retry, stale result,
editor-only failure, and ARA failure without claiming crash isolation.

### 5. Hardening and release evidence

- Run official VST3/CLAP fixtures plus deterministic failure fixtures on all
  release platforms.
- Test repeated load/restore/process/editor/state/ARA failures during playback,
  recording, project switching, save, and shutdown.
- Add a two-hour soak with contained failures and verify bounded memory, handles,
  queues, diagnostics, and XRUN behavior.
- Separately retain fatal-process relaunch tests, since they prove the boundary
  this feature intentionally cannot cover.

Exit: all Current roadmap checks pass on Windows/ASIO, macOS/CoreAudio, and
Linux/ALSA, with ARA behavior unchanged except for typed contained failures.

## Test matrix

The minimum automated matrix crosses failure stage with effect/instrument,
VST3/CLAP, active/bypassed, current/stale generation, and playback/recording.
ARA-specific rows cover analysis callback, document change, archive restore,
archive save, editor open, editor close, and project shutdown.

Concurrency tests must prove that a failed instance publishes at most one state
transition, an older generation cannot re-enter the graph, and graph retirement
cannot drop a processor still leased by the callback. Use `loom` where the
ownership model can be reduced to deterministic primitives; use engine-level
barriers and fault fixtures for the full runtime.

Performance evidence must measure callback time before and after output
validation. If validation threatens the real-time budget, prefer checks already
available at the format boundary or sampled diagnostics rather than weakening
the callback contract.

## Work ordering

Implement taxonomy and fixtures first, then the audio fallback, then control and
ARA cleanup, then recovery UI, and finally platform hardening. This order gives
every later layer a deterministic failure source and prevents the UI from being
built around free-form host errors.
