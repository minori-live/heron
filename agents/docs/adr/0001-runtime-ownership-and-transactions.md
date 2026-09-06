# ADR-0001: Own the embedded runtime and commit state explicitly

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Scope: current runtime and transaction contract; release evidence belongs in the roadmap
- Related: [Architecture](../architecture.md), [Native boundary](../native-call-boundary.md), [Resource and error contract](../cross-process-error-contract.md)

## Context

Audio, plug-in controllers, ARA documents, native editors, and project mutations
need unambiguous owners. A supervised audio helper would add transport,
supervision, window coordination, and recovery machinery incompatible with the
chosen ARA ownership model. Within one process, preparation, publication, and
failure recovery still require explicit transactions: candidate processors must
not replace active instances, and a lost response must not repeat a committed edit.

## Decision

### Runtime and real-time ownership

Electron main owns one `@heron/dsp-node` embedded runtime, its lifetime, and
application policy. Rust owns the audio engine, cpal streams, bounded control
queues, plug-in actors, and telemetry. Renderer/main Electron IPC crosses a
process boundary; the project database runs in its own worker thread. The main/native
MessagePack envelope is a local N-API ABI, not an audio IPC transport.

Renderer and preload never import the addon. They use explicit resource handles
and serializable success/error unions through `window.heron`. Exceptions,
rejected Promises, panic payloads, ambient current resources, and free-form
error strings are not cross-boundary protocol semantics.

The audio callback performs no allocation, blocking synchronization, filesystem
work, logging, Electron IPC, or N-API calls. Compile graphs and prepare resources
off the callback; retire callback-owned resources through bounded queues for
control-thread destruction. Windows native builds always include ASIO.

Electron owns the platform application loop and each native editor's parent
window and toolbar. Rust owns the native child view and thread-affine plug-in
and ARA work, serviced through a bounded UI mailbox and coalesced wake. Detach
the view before destroying its parent or instance. Do not introduce a second
application loop, audio helper, OS shared-memory transport, or restart supervisor.
Isolated catalog probes do not change live processing ownership.

### Mutation and receipt ownership

Stateful operations define one commit point, prepare/abort cleanup, resource
generation and revision checks, and idempotency or operation-status recovery.
Completion order never grants commit authority. Unknown outcomes preserve the
reconciliation record and quarantine the affected resource rather than guessing.

For ordinary project commands:

- Apply SQL and decode the resulting graph inside one database transaction.
  Snapshot failure rolls back the write; a retained prepared token means no
  commit occurred and can be aborted without quarantining a known failed edit.
- The worker retains a committed result. Repeating the same transaction token
  returns that result without applying SQL again.
- Main retains its terminal response before acknowledging the worker token.
  Failed acknowledgement never turns a known commit into an unknown outcome;
  the next command retries it. A replaced project handle discards old tokens.
- The renderer adopts or rejects a known terminal result, then acknowledges
  main. Failed acknowledgement is retried on later graph interactions.
  Main-originated sidechain edits acknowledge after handling their own result.
- Unknown results remain retained and the graph stays quarantined until an
  authoritative workspace is re-established. Reopening creates a fresh workspace.
- Replay lookup precedes validation of the revision for a new operation. An
  operation ID cannot be reused for another resource generation.
- Acknowledgement ends replay eligibility. Retention remains bounded; arbitrary
  eviction, timers, and larger limits do not replace ownership transfer.

Domain validation has a typed error; message wording does not choose retry or
outcome semantics. Other protocols document their own receipt lifecycle, such
as [update admission receipts](0006-tagged-release-updates.md).

### Graph and plug-in publication

Document graphs use one prepare/activate/abort protocol. Preparation owns
candidate processors separately from the active registry. Destruction respects
outstanding processor leases. Failed activation leaves both graph and plug-in
state consistent; it cannot report prepared state after consuming its instances.

The candidate retains compilation ownership until commit or abort. Internal
plug-in refreshes coalesce to one pending latest snapshot while the background
actor continues serving device queries. They cannot supersede a document
candidate or block the UI mailbox or engine actor while awaiting ownership.
One off-callback compilation path serves document and runtime refreshes; there
is no speculative general-purpose priority scheduler.

With audio stopped, parking the prepared graph in the engine's pending graph
commits publication. Running audio additionally requires callback publication
acknowledgement. Retry prepares a replacement instance with a new generation
from committed state. Late parameter, editor, ARA, latency, tail, or graph
results from an old generation cannot publish.

### Plug-in layout and contained failures

The format-neutral processor contract separates persisted channel-strip
`audioMode` from native layouts proven by the isolated probe. For mono-to-stereo,
prefer proven native 1-in/2-out; otherwise adapt proven 1-in/1-out by duplicating
processed left output to right. Reject modes with neither a proven layout nor
a defined adapter before loading. Resolve the native layout at preparation,
not in persisted project state. Apply adapters without allocation after successful
processing; bypass/unavailable passthrough already preserves the host topology.

Containment applies when an operation returns control or produces safely
validatable data: initialization, bus activation, restore/save, processing,
bounded output, parameter delivery, editor lifecycle, ARA, queue pressure, and
stale generations. Access violations, memory corruption, aborts, deadlocks, and
non-returning third-party calls are not contained. Do not catch panics in the
audio callback. Fatal native failure may terminate main; relaunch uses saved
versus recoverable working-copy recovery and does not promise audio continuity.

A failed instance retains its project slot, identity, routing, alias, creative
bypass setting, and committed state. Effects emit delay-aligned dry audio and
instruments emit silence while loading, bypassed, failed, or quarantined. Output
becomes audible only after successful processing and bounded host validation.
Emit at most one bounded failure signal per transition from the callback.

The closed runtime states are unloaded, loading, active, bypassed, failed, and
quarantined. Typed failures identify category, stage, outcome, retry eligibility,
generation, graph revision, and diagnostic ID. Explicit Retry and Keep Bypassed
actions replace automatic re-enabling. Repeated failures quarantine an artifact
fingerprint/native ID; a changed fingerprint is eligible for explicit retry.

| Boundary     | Commit or contained failure rule                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Load/restore | Publish a validated replacement; failure retains a visible processor-less or bypassed slot and committed bytes. |
| Process      | Validate output before exposing it; otherwise dry audio or silence.                                             |
| Parameter    | Accept only for the current generation; report stale, full, or failed outcomes.                                 |
| Editor       | Acknowledge attachment; clean partial views on failure; quarantine uncertain detach.                            |
| State save   | Durably replace validated bytes; failure preserves prior committed state.                                       |
| ARA          | Apply only validated current-generation results; reject or quarantine the affected operation.                   |

### Device recovery

Device loss immediately presents recovery choices while bounded reconnect
attempts continue. A committed explicit selection creates the authoritative
generation; older attempts cannot overwrite it. The original device may resume
before a choice commits, while the dialog remains available and the later choice
still wins. Candidate-list refresh must preserve focus and the user's draft.

## Alternatives rejected

- Audio/per-plug-in isolation adds a different ARA, GUI, and real-time recovery
  architecture; it is not an incremental containment mechanism.
- Treating every returned plug-in error as fatal needlessly interrupts unrelated
  paths. Deleting or creatively bypassing the persisted slot confuses failure
  with user intent.
- Parallel graph protocols and speculative job classes multiply lifetime rules.
- Dropping receipts on dispatch loses reconciliation; retaining every snapshot
  indefinitely exhausts long editing sessions.
- Last-completion-wins recovery can overwrite a deliberate device choice.

## Consequences

The host can preserve unrelated legal graph paths after returned failures, but
cannot claim native crash isolation. Protocol peers evolve together without a
new external ABI compatibility promise. UI responsiveness remains bounded
between plug-in calls; a thread-affine third-party call cannot be preempted.

## Verification

Keep native-import and dependency checks, typed wire fixtures, more than 2,048
acknowledged edits, duplicate/stale tokens, failed SQL snapshot reads, lost
responses/acknowledgements, quarantine, candidate lease safety, rollback,
competing refreshes, stopped/running publication, and reordered device completions.
Exercise lifecycle failures across formats, effects/instruments, playback and
recording, including PDC, sidechains, editor and ARA cleanup. Release evidence
requires official fixtures, callback-cost checks, fatal relaunch recovery, and
platform hardware/resource/XRUN soaks; unit tests do not establish those results.

## Reconsider when

Measured contention, durable cross-launch replay, transactional device handoff,
or a demonstrated need for process isolation justifies a complete replacement
ownership model preserving ARA, native editors, real-time bounds, and commit rules.
