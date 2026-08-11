# ADR-0011: Contain returning plug-in failures in process

- Status: Accepted
- Date: 2026-08-11
- Owners: project maintainers
- Related: `agents/docs/adr/0001-embedded-audio-runtime.md`, `agents/docs/product-live.md`, `agents/docs/roadmap.md`, `agents/docs/cross-process-error-contract.md`

## Context

Heron hosts VST3, CLAP, ARA, audio processing, controllers, and native editor
child views inside the embedded runtime. A single plug-in can reject a host
operation or produce invalid output without making the rest of the committed
audio graph invalid. Treating every such result as a project-wide failure would
unnecessarily interrupt playback and obscure which instance needs attention.

ADR-0001 deliberately rejects helper-process and per-plug-in process isolation.
Those designs require supervision, shared or copied real-time data, mutation
reconciliation, native-window coordination, and an ARA ownership model that the
Current product cannot preserve. In-process containment therefore needs a
precise boundary: Heron can handle failures that return control to a host-owned
boundary, but cannot claim protection from arbitrary third-party native code.

The first implementation detects returned process-call rejection and non-finite
audio, enters a sticky instance failure state, restores dry audio for effects,
emits silence for instruments, and reports a typed failure to the owning slot.
The remaining lifecycle and recovery behavior needs one durable decision so
later work does not weaken real-time, ownership, or project-state guarantees.

## Decision

Heron contains supported plug-in failures inside the existing process and at the
affected instance. It does not introduce a helper process, OS IPC, shared
memory, watchdog restart, or a second application loop. ARA document,
controller, archive, analysis, and editor ownership remains in the embedded
runtime.

Containment applies only when an operation returns, reports a failure, or
produces data that Heron can validate safely. Supported host-owned boundaries
include initialization and bus activation, state restore and save, processing,
bounded output metadata and non-finite audio validation, parameter delivery,
editor attach/open/resize/detach, ARA callbacks, bounded queue overflow, stale
instance generations, and unwind-safe Rust callbacks outside the real-time
thread.

Containment does not cover access violations, segmentation faults, illegal
instructions, native stack or memory corruption, process aborts, termination,
deadlock, or a third-party call that never returns. Rust panics must not be
caught inside the audio callback or used as a substitute for panic-free
real-time code. These failures retain ADR-0001 behavior: Electron main may
terminate, and relaunch uses the existing saved-versus-recoverable working-copy
choice. Product text must not describe this design as process isolation or crash
protection.

### Instance state and audio behavior

A contained failure changes only the owning runtime instance. The project slot,
plug-in identity, routing, control alias, persisted `enabled` value, and last
committed state remain intact. Other legal graph paths continue.

- An effect in `loading`, `failed`, `bypassed`, or `quarantined` state emits its
  delay-aligned dry input.
- An instrument in those states emits silence.
- A processing result becomes audible only after the call succeeds and its
  bounded output passes host validation.
- The runtime emits at most one bounded failure signal for each state
  transition and performs no logging, allocation, IPC, filesystem access, or
  blocking synchronization from the audio callback.

Runtime failure is distinct from a user's creative bypass choice. The public
states remain `unloaded`, `loading`, `active`, `bypassed`, `failed`, and
`quarantined`. Control flow uses a typed failure record rather than parsing a
human-readable message. The record contains a category, lifecycle stage,
terminal outcome, retry eligibility, instance generation, graph revision, and
diagnostic ID. Rust, the local MessagePack ABI, Electron main, preload, and the
renderer use the same closed taxonomy and reject malformed or ambient fields.

### Generation and commit rules

Every replacement instance receives a new generation. Retry is explicit and
prepares a replacement from only the last committed state. The replacement is
published atomically and initially respects the user's bypass state; a failed
attempt leaves either the previous committed instance or an explicit
failed/bypassed slot. Late results from an older generation cannot publish
state, parameters, latency, tail changes, editor events, ARA callbacks, or graph
changes.

Lifecycle operations keep these commit points:

| Operation       | Commit point                                        | Contained failure result                               |
| --------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Load/initialize | Prepared replacement is active and graph-published  | Keep a processor-less or bypassed visible slot         |
| Restore state   | Validated restored instance is graph-published      | Retain committed bytes and mark the attempt failed     |
| Process block   | Output passes bounded host validation               | Emit delay-aligned dry audio or silence                |
| Set parameter   | Current instance generation accepts the value       | Return typed stale, full, or failed outcome            |
| Open editor     | Child view attachment is acknowledged               | Remove the partial surface; audio may remain active    |
| Close editor    | Child view detaches before parent destruction       | Quarantine editor state if safe detach cannot complete |
| Save state      | Validated bytes durably replace prior project state | Keep the previous committed bytes authoritative        |
| ARA update      | Current-generation result is validated and applied  | Reject or quarantine only the affected ARA operation   |

Graph replacement remains prepare/activate/abort. A contained failure must not
remove the project slot or make an unrelated processor unavailable. If Heron
cannot prove whether a stateful operation committed, it uses the existing
quarantined mutation result and reconciliation path instead of guessing.

### Recovery and quarantine

The owning plug-in surface shows the failed state, stage, and explicit recovery
actions. Health details retain bounded diagnostic context, and a non-modal
notification may announce only a newly occurring failure. Retry and Keep
Bypassed are user actions; Heron does not silently re-enable or repeatedly
invoke a failed instance.

Repeated contained failures are quarantined by plug-in artifact fingerprint and
native ID. A changed artifact fingerprint becomes eligible for explicit retry.
Generation checks apply to queued parameter work, editor operations, ARA
analysis progress, document changes, archive operations, and shutdown cleanup.
Native editor views always detach before their parent or plug-in instance is
destroyed.

## Alternatives rejected

### Per-plug-in or helper-process isolation

This could survive some native crashes, but it breaks the current ARA ownership
model and introduces supervision, real-time transport, native-window, and
transactional reconciliation problems outside the Current architecture.

### Treat every plug-in failure as fatal

This is simpler but discards useful failures that return cleanly and can be
isolated to one instance without invalidating the graph or committed project
state.

### Automatically unload, delete, or bypass the project slot

Runtime failure is not user intent. Mutating the project graph or creative
bypass state would make recovery surprising and could persist an incidental
runtime condition.

### Catch every panic or foreign crash

Foreign crashes cannot be made safe with Rust unwinding, and catching a panic
inside the audio callback weakens the real-time contract. `catch_unwind` is
limited to explicitly guarded, unwind-safe, host-owned non-real-time callbacks.

## Consequences

- Returned failures can preserve unrelated playback, PDC, side chains, meters,
  transport, and recording taps.
- Each plug-in lifecycle boundary must return a typed outcome and implement
  prepare/abort cleanup; initialize, restore, parameter, editor, state-save, and
  ARA call-site coverage remains required.
- Retry requires replacement generations rather than merely clearing a failure
  bit; the initial re-arm behavior must evolve without recreating ARA ownership
  out of process.
- Repeated-failure fingerprint quarantine, health details, localized recovery
  actions, and stale-result tests remain required product work.
- Output validation adds callback cost and must be measured. If a scan threatens
  the real-time budget, validation moves to an already-bounded format boundary
  or sampled diagnostics rather than weakening callback constraints.
- Fatal native failures still terminate the process and need separate relaunch
  recovery tests.

## Verification

Protocol tests cover every failure category and lifecycle stage, exact
cross-language MessagePack encoding, generation and graph revision data, and
rejection of unknown, missing, inconsistent, or ambient fields. Deterministic
fixtures reject operations without undefined behavior; host-panic fixtures run
only at unwind-safe non-real-time boundaries.

Engine and runtime tests cross failure stage with effect/instrument, VST3/CLAP,
active/bypassed, current/stale generation, and playback/recording. They prove
sample-correct dry or silent fallback, preserved PDC and side chains, at most one
failure transition, stale-generation rejection, graph lease safety, editor
cleanup, and ARA archive, analysis, content, editor, and shutdown behavior. Use
`loom` where ownership can be reduced to deterministic primitives and
engine-level barriers for the full runtime.

Renderer tests cover localized failure, Retry, Keep Bypassed, stale results,
editor-only failure, and ARA failure without claiming crash isolation. Release
evidence includes callback-time comparison, official VST3/CLAP fixtures,
deterministic failure injection during playback, recording, project switching,
save, and shutdown, and a two-hour resource/XRUN soak on Windows/ASIO,
macOS/CoreAudio, and Linux/ALSA. Fatal-process relaunch tests remain separate.

## Reconsider when

Replace this ADR only if a proven product requirement justifies process
isolation and a complete design preserves ARA ownership, native editor behavior,
real-time transport, project mutation commit semantics, and deterministic crash
reconciliation across every release platform.
