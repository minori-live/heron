# ADR-0004: Build standalone layered Live documents on the shared Mixer

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Scope: accepted architecture for Current Live delivery; shared Mixer separation is implemented, Live documents are not yet delivered
- Related: [Roadmap](../roadmap.md), [Performance contract](../product-live.md), [Persistence](0002-project-persistence-and-media.md), [Runtime transactions](0001-runtime-ownership-and-transactions.md)

## Context

Studio owns arrangement, media, recording, musical maps, and Mixer state. Live
needs a dependable Mixer baseline, hierarchical variations, document-owned MIDI
bindings, and declarative performance UI. A mode in the same archive would retain
unrelated Studio state; a separate Mixer implementation would make import lossy
and let routing, plug-in, and parameter semantics drift.

Live project delivery is the Current roadmap stage after the closed v0.5.0
performance-readiness milestone. This decision does not describe Live features
as shipped or change the existing Studio MIDI contract.

## Decision

### Documents, persistence, and import

Studio will default to `.hrs`, with `.heron` an equally supported Studio extension
opened/saved in place. Live uses `.hrl`. A persisted document-kind marker is
authoritative; extension/marker mismatch is a typed format error. An unmarked
Studio archive may be recognized through its supported migration path and receive
the marker in its working copy. These associations belong to Live delivery.

Both kinds use PGlite archives but have independent Drizzle schemas, templates,
workers, migration directories/journals, and working-copy recovery. Each kind may
declare format stability independently. Before stability, development baselines
may reset without archive compatibility guarantees; after stability, migrations
are append-only. Unsupported newer formats return typed errors. Supported older
archives migrate in working copies and are rewritten only on save.

Mixer snapshots, invariants, routing selectors, core Drizzle tables, and readers
have one shared implementation independent of Track, Clip, and musical maps.
Studio and Live add extension tables and domain rules. Shared table changes
generate migrations in each affected lineage; identical tables do not make
migration journals or archives interchangeable.

A new standalone Live document may import one complete typed Mixer projection
from a migrated Studio archive. Open through the Studio service, generate new
Live IDs, remap internal references, validate, and insert in one Live transaction.
Do not copy tables, journals, Studio IDs or application settings. There is no
source link, synchronization, revision ancestry, or write-back. Complete Mixer
merge into an existing Live document is rejected; selective Channel Strip import
needs a separate future decision.

Live excludes Studio Tracks, arrangement, audio/MIDI Clips, media library,
tempo/time/key-signature timelines, recording, automation, and Studio history.
Future Live playback or Clock must be explicit Live concepts.

### Ownership and resolution

The hierarchy is fixed: **Project → Set → Patch**. Sets cannot nest and are
non-activatable overlays, not residency/preload boundaries. Patches are activatable
leaves. Opening has no active Patch: root is a valid Project-only runtime state
and users may return to it. Resolve Project fields, containing Set overrides,
then Patch overrides afresh on each activation; previous-Patch state never leaks.

Every entity has one owning layer. Project entities are globally visible, Set
entities only within that Set and its Patches, and Patch entities only there.
Master, Output, audio backend/device, sample rate, buffer and physical I/O are
Project-owned. Sets/Patches may create Audio, Instrument and Aux Channels, Sends,
bindings and UI entities. A plug-in shares its Channel owner: descendants cannot
add, remove, replace or reorder plug-ins on inherited Channels; create a new
Channel for another chain.

References may address the current layer or its ancestors, never siblings,
another Set, or descendants. This applies to routing, Sends, sidechains, MIDI and
UI targets. A descendant override may route an inherited Channel to a target
owned at that descendant layer.

### Field overrides, editing, deletion, and copying

Persist per-field overrides, distinguishing absence, explicit equality with the
parent, and explicit null. Revert removes the current override. Opaque plug-in
state is one indivisible field; stable parameter keys may be overridden separately.
Fixed, overrideable and Project-only fields are versioned domain policy, not
user-configurable or persisted dynamic rules. Descendants may override supported
parameters, enabled state and opaque state, but not descriptor, slot ownership,
sidechain structure, audio layout or alias.

Edit Mode changes the nearest layer defining an inherited field. Taking ownership
in the current Set/Patch requires explicit override creation. The UI identifies
the defining layer and scope affected by an edit.

A child cannot delete an inherited entity; explain its owner and offer navigation
there. Owner deletion computes the complete recursive reference closure and
previews deleted entities, removed overrides/references, inherited fallbacks and
required route replacements. Retarget required references or explicitly include
their dependants. The validated plan commits atomically after confirmation.
Set/Patch deletion may include owned subtrees with the same impact preview.

Entities/layers cannot move between scopes. Copy creates new IDs, remaps references
within the copied subtree and preserves Project references. Cross-Set Patch copy
fails if any source-Set reference remains. Set copy includes its entities and
Patches. Validate and insert atomically; never guess or copy missing dependencies.

### Performance, devices, bindings, and UI

Perform Mode locks structural editing and permits root/Patch activation and
Mixer, MIDI and declarative UI controls. These controls create volatile overrides
without Undo or dirtying the document. `Capture Performance Changes` previews
selected values grouped by defining layer and writes, by default, to the nearest
existing owner. Explicitly creating a Set/Patch override is available; root Capture
targets only Project. Capture is one undoable transaction; uncaptured values stay
volatile. Otherwise Save is Perform Mode's only durable operation. Capture/Save
failure never changes the running graph. Persistence remains off the callback.

Project strictly persists backend, audio device IDs/configuration and enabled
physical MIDI IDs. There are no logical controller roles or arbitrary/default
device fallback. Missing audio permits Edit but blocks Perform until explicit
Project reconfiguration. Missing MIDI leaves bindings unavailable without blocking
unrelated audio.

Bindings are layer-owned stable-ID entities addressing an enabled physical device
and MIDI message. Descendants may override inherited bindings. Another binding
at the same address adds fan-out rather than shadowing; show every resulting
action. Studio's application-owned ordered-index/alias mappings remain governed
by [ADR-0003](0003-midi-control-and-observation.md).

Performance UI is versioned validated declarative data obeying the same ownership,
override and reference rules. No arbitrary HTML, JavaScript, Vue components or
executable local content enters an archive. Concrete vocabulary/schema is deferred.
Unknown components or targets are visibly unavailable but do not block Edit Mode.

### Activation and failures

Resolve, validate and prepare the effective graph and plug-in state off the
callback, then commit one graph generation. Only then publish active selection.
The latest explicit selection's generation has authority, not completion order.
Preparation failure preserves the previous selection and graph. Set/Patch format
does not prescribe preloading or plug-in residency.

Initial exit policy is `cut`: exiting instruments receive all-notes-off and
affected paths receive a click-free ramp. Cross-Patch sustain, tails and transitions
are deferred; any future transition must bound outgoing runtime lifetime.

Failure to create/restore a target plug-in blocks activation instead of silently
degrading the Patch. After activation, supported returned failures contain only
the affected instance with a visible warning under ADR-0001. Fatal failure and
saved-versus-working-copy relaunch retain the existing application policy.

## Alternatives rejected

- One Studio archive with a Live mode retains timeline and saving ambiguity.
- An unrelated Mixer model duplicates routing and plug-in semantics.
- Linked Studio sources require identity, ancestry, conflict and availability rules.
- Complete snapshots at every layer mask parent changes with accidental overrides.
- Nested/movable Sets complicate reference scope and silently change inheritance.
- Set-based preload makes document structure dictate runtime memory policy.
- JSON-plus-binaries adds a second persistence/recovery stack.
- Executable UI adds file-trust, compatibility and performance obligations.

## Consequences

Two independent document and migration matrices share one Mixer model. Moving a
Live archive between rigs requires explicit device edits. Activation may take
time; the old graph stays authoritative until commit. The former one-file-format
Studio-to-stage idea is replaced by one shared Mixer and explicit one-time import.

## Verification

Delivery requires schema/lineage independence, kind/extension and version checks,
working-copy migration/recovery, typed import with remapped IDs and rollback,
field presence/equality/null/revert, ownership and reference scope, atomic recursive
deletion/copy, no previous-Patch leakage, exact devices and additive bindings,
Edit/Perform/Capture semantics, stale activation rejection, root return, bounded
cut and instance containment. Reject Studio-only Live tables, SQL transport,
table-copy imports, executable UI and callback persistence/allocation. Manual
evidence covers device loss, repeated switching, Save/Capture under load and
two-hour resource/XRUN performance. Acceptance of this design is not that evidence.

## Reconsider when

Real sets require another inheritance model, strict IDs prevent supported rigs,
measured PGlite latency is inadequate, or linked synchronization, nested Sets,
executable UI or bounded Live playback become justified product requirements.
