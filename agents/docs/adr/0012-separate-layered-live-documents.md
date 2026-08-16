# ADR-0012: Add separate layered Live documents over the shared Mixer model

- Status: Accepted
- Date: 2026-08-16
- Owners: project maintainers
- Related: `agents/docs/roadmap.md`, `agents/docs/product-live.md`,
  `agents/docs/project-database.md`

## Context

Heron's Studio archive owns an arrangement, media, recording state, musical
maps, and a Mixer graph. A stage-oriented document has a different lifecycle:
it needs a dependable Mixer baseline, hierarchical performance variations,
project-owned MIDI bindings, and a declarative performance UI, but it does not
need the Studio timeline or editing model.

Treating this workflow as another mode of one archive would keep unrelated
Studio state on the live path and make ownership during performance ambiguous.
Creating an unrelated Mixer model would instead make Studio import lossy and
allow routing, plug-in, and parameter semantics to drift. A durable decision is
also required for hierarchical override ownership, activation failure, device
identity, archive compatibility, and the existing roadmap statement that
Studio-to-Stage would not introduce another format.

This decision defines the Next roadmap architecture. It does not add Live
documents to the Current Live-performance-readiness milestone, which continues
to exercise Studio projects and application-owned MIDI mappings. Live document
delivery takes priority over Studio creation completion after Current exits.

## Decision

### Document kinds, extensions, and import

Heron will have two independent document kinds:

- Studio documents use `.hrs` by default. `.heron` remains an equally supported
  Studio extension and is opened and saved in place without a legacy or
  conversion workflow.
- Live documents use `.hrl`.

The archive's persisted document-kind marker is authoritative. An extension
and marker mismatch returns a typed format-mismatch result. A Studio archive
without the marker may be recognized through the supported Studio migration
path and receive the marker in its working copy.

A Live document is standalone. It has no source-project link, synchronization,
revision relationship, or write-back path. Creating a new Live document may
import a complete Mixer projection from a Studio archive. The importer first
migrates and opens the Studio archive through the Studio service, reads a
current typed Mixer DTO, generates new Live entity IDs, remaps internal
references, validates the result, and inserts it in one Live transaction.
Import does not copy database tables, migration journals, application settings,
or Studio IDs. A complete Studio Mixer cannot be merged into an existing Live
document. Selective Channel Strip import is a separate future decision.

Live documents contain no Track, arrangement, audio or MIDI Clip, Studio media
library, tempo/time-signature/key-signature timeline, recording model,
automation, or Studio edit history. Future Live playback or clock capabilities
must be designed as Live concepts rather than restoring the Studio arrangement
implicitly.

### Persistence ownership

Both document kinds remain PGlite data-directory archives. Studio and Live have
separate Drizzle schemas, templates, migration directories, workers, and
migration journals. They may declare format stability independently. Before a
kind is declared stable, its development migration baseline may be reset and
development archives have no compatibility guarantee. After stability, that
kind's migrations are append-only. A newer unsupported format returns a typed
error; a supported older archive migrates in a working copy and is not rewritten
until the user saves.

The core Mixer Drizzle table definitions are one shared persistence source of
truth and are included in both schemas. Studio-only and Live-only state uses
extension tables. The two migration histories are still generated and shipped
independently; changing a shared table produces a migration in each affected
lineage. Runtime domain invariants and import DTOs remain shared through the
Mixer project model. Physical table similarity is not an import or compatibility
mechanism.

### Fixed inheritance hierarchy

A Live document has exactly three ownership levels:

```text
Live Project
└── Set
    └── Patch
```

Sets cannot nest. A Set is a non-activatable overlay, not a preload or runtime
residency boundary. A Patch is an activatable leaf. No Patch is active when the
document opens; the root is a valid runtime state whose effective configuration
contains only the Project layer. Users may switch from a Patch back to the root.
Selecting a Patch resolves:

```text
Project fields + containing Set overrides + Patch overrides
```

Resolution is deterministic and starts from those layers on every activation;
state from the previously active Patch never bleeds into the next one.

Every entity has one owning layer. An entity created at Project is visible
everywhere, one created at Set is visible only in that Set and its Patches, and
one created at Patch is visible only in that Patch. Master, Output, the audio
backend and device, sample rate, buffer, and physical I/O configuration are
Project-owned. Sets and Patches may create Audio, Instrument, and Aux Channels,
Sends, bindings, and UI entities. A Plug-in has the same owner as its Channel:
a lower layer cannot add, delete, replace, or reorder a Plug-in on an inherited
Channel and must create a new Channel when it needs another chain.

Project fields may reference Project entities. Set fields and overrides may
reference Project or that Set's entities. Patch fields and overrides may
reference Project, the containing Set, or that Patch's entities. They cannot
reference another Set, a sibling Patch, or a descendant. This rule applies to
routing, Sends, sidechains, MIDI targets, and UI targets. A lower-layer override
may temporarily route an inherited Channel to a target owned by that layer.

### Field ownership and overrides

Overrides are persisted per field, not as complete entity snapshots. Absence,
an explicit value equal to the parent, and an explicit nullable value are
distinct states. Reverting an override removes that field at the current layer
and exposes the inherited value. Opaque Plug-in state is one indivisible field;
stable Plug-in parameter keys may also be overridden independently.

Which fields are fixed, overrideable, or Project-only is built into the
versioned Live domain implementation. It is not user-configurable or persisted
as dynamic policy. In particular, descendants may override supported Plug-in
parameters, enabled state, or the entire opaque state, but not the descriptor,
slot ownership, sidechain structure, audio layout, or control alias.

In Edit Mode, changing an inherited field edits the nearest layer that defines
the field. A user must explicitly create an override before the current Set or
Patch takes ownership of that field. The UI exposes the defining layer and the
scope affected by an edit.

An inherited entity cannot be deleted from a child layer. Such an attempt opens
a dialog that names its owner and can navigate there. A deletion initiated at
the owner computes the complete recursive reference closure. The confirmation
previews all deleted entities, removed overrides and references, inherited
fallbacks, and required route replacements. Required references must be
retargeted or their dependent entities explicitly included. The final valid
plan commits in one transaction. Patch and Set deletion may include their
complete owned subtrees after the same impact confirmation.

Layers and entities cannot move between ownership scopes. Copying creates new
IDs and remaps references wholly inside the copied subtree while retaining
Project references. A Patch copied to another Set is rejected if it retains a
reference to its source Set. Copying a Set clones its owned entities and all
child Patches. Copy validation and insertion are atomic; Heron does not guess,
copy, or retarget unavailable dependencies.

### Edit and performance state

Edit Mode mutates the durable Live document. Perform Mode locks structural
editing and permits Patch/root activation, Mixer, MIDI, and declarative UI
control. These controls create volatile runtime overrides and do not themselves
enter undo history or mark the document dirty.

`Capture Performance Changes` previews selected runtime values grouped by
their defining Project, Set, or Patch layer. By default it writes each field to
the nearest layer that already defines it. The user may explicitly create a
current Set or Patch override for a selected inherited value. At the root only
Project is a valid destination. Capture is one undoable document transaction;
uncaptured values remain volatile. Perform Mode otherwise exposes only Save as
a durable operation. Capture or Save failure does not alter the running graph.
Archive work and filesystem I/O remain outside the audio callback.

### Devices, MIDI bindings, and custom UI

The Project layer strictly persists the audio backend, audio input/output device
IDs and configuration, and the set of enabled MIDI device IDs. Heron does not
persist logical controller roles or fall back to an arbitrary/default device.
A missing audio device permits Edit Mode but blocks Perform Mode until the
Project configuration is explicitly changed. A missing MIDI device leaves its
bindings configured and unavailable without blocking unrelated audio.

MIDI bindings are layer-owned entities with stable IDs. A binding addresses an
enabled physical MIDI device ID plus its MIDI message address. A lower layer
may explicitly override an inherited binding. Creating another binding for the
same address is additive rather than shadowing, so one input may intentionally
fan out to several targets; the UI shows every resulting action.

Custom performance UI is persisted as a versioned, validated, declarative
model and obeys the same ownership, field override, and reference rules. A Live
archive cannot carry arbitrary HTML, JavaScript, Vue components, or executable
local content. The concrete UI schema and component vocabulary are deferred.
Unknown UI components or targets are visibly unavailable and do not prevent the
Mixer document from opening in Edit Mode.

### Activation and failure behavior

Root/Patch switching is a stateful prepare-and-commit workflow. Off the audio
callback, Heron resolves and validates the target effective configuration,
prepares the graph and Plug-in state, and commits one graph generation. The UI
publishes the new active selection only after that commit. An activation
generation makes the latest explicit selection authoritative; completion order
does not grant commit authority. Failure preserves the previous root/Patch and
graph.

Set and Patch remain logical document concepts. The format does not prescribe
preloading or Plug-in residency. Any implementation strategy must preserve the
same atomic activation and failure behavior.

The initial Patch-exit policy is `cut`: exiting instruments receive
all-notes-off and affected paths receive a click-free ramp. Cross-Patch sustain,
effect tails, and transitions are deferred. A future transition design must set
a finite maximum lifetime for the outgoing runtime state.

A Plug-in that cannot be created or restored while preparing a target blocks
activation rather than silently degrading the new Patch. A recoverable failure
after activation follows the existing in-process containment policy and
bypasses or disables only the affected instance with a visible warning. Fatal
native or Plug-in failure and saved-versus-working-copy recovery retain their
existing application behavior.

## Alternatives rejected

### Keep one Studio archive and add a Live mode

This keeps timeline, recording, media, and Studio edit state on the stage path
and makes ownership and saving ambiguous. A Live document has a deliberately
smaller data and failure surface.

### Create an independent Live Mixer model

This provides maximum freedom but duplicates routing, Plug-in, parameter, and
graph invariants. Heron instead shares the Mixer domain and core persistence
tables while giving each document kind independent extensions and migrations.

### Link a Live document to a Studio source

Automatic or manual resynchronization requires revision ancestry, conflict
resolution, stable cross-document identity, and source availability. A one-time
typed import makes the stage artifact self-contained and predictable.

### Store complete entity snapshots at every layer

Snapshots make an unrelated parent change appear overridden and cause stale
fields to accumulate. Field-level overrides retain explicit ownership.

### Allow nested or movable Sets

Arbitrary nesting makes resolution, copying, reference scope, and UI explanation
recursive without a demonstrated performance need. Moving silently changes
inheritance; validated copying is explicit.

### Make Set a preload boundary

This couples document grouping to a runtime optimization and can require every
child Patch's Plug-ins to be resident. Residency remains an implementation
choice beneath transactional Patch activation.

### Store Live state as JSON plus binary files

A lightweight archive maps naturally to the hierarchy, but it would introduce
a second persistence and recovery stack. Live reuses PGlite archive, template,
migration, working-copy, and transaction infrastructure while keeping its
schema lineage independent.

### Permit executable custom UI

Arbitrary scripts make validation, compatibility, performance bounds, and file
trust substantially harder. Versioned declarative capabilities can grow without
turning a performance document into an executable package.

## Consequences

- Heron gains two document lifecycles and two migration/test matrices, although
  the core Mixer table definitions and domain invariants remain singular.
- Shared Mixer schema changes must be reviewed and migrated in both document
  lineages.
- The desktop needs document-kind dispatch, `.hrs`/`.heron`/`.hrl` file
  associations, separate templates and workers, typed import, and independent
  working-copy recovery.
- Live resolver and persistence code must preserve field presence, owner scope,
  stable IDs, and nullable override semantics without generic SQL transport.
- Strict device IDs favor predictable stage behavior over automatic portability;
  moving a Live document to another rig requires explicit Project edits.
- Patch activation may take time because residency is not prescribed. The old
  graph remains authoritative until preparation commits.
- The Current milestone and ADR-0002 remain unchanged for Studio documents.
  Project-owned hierarchical MIDI bindings apply only to Live documents.
- Implementation changes the roadmap promise from one file format to one shared
  Mixer model with explicit Studio-to-Live import.

## Verification

- Schema tests prove shared Mixer table definitions are identical in Studio and
  Live schemas while each migration journal and template remains independent.
- Archive tests cover `.hrs` and `.heron` as Studio aliases, `.hrl` as Live,
  document-kind mismatch, unsupported newer versions, working-copy migration,
  save/reopen, and recovery.
- Import integration tests migrate Studio fixtures, map through the typed DTO,
  regenerate IDs, remap references, omit every excluded Studio domain, reject
  merge, and roll back any invalid import.
- Resolver property tests cover root, Set, and Patch precedence; explicit equal
  and null values; revert; nearest-owner edits; Plug-in parameter and opaque
  state overrides; and absence of previous-Patch state bleed.
- Ownership tests cover creation visibility, fixed Set depth, root-only
  Master/Output/device state, Plug-in/Channel co-ownership, reference scope,
  rejected moves, valid copies, and atomic copy failure.
- Recursive deletion tests cover references of references, fallback overrides,
  required route replacement, cascade previews, user cancellation, graph
  validation, and transaction rollback.
- MIDI tests cover the enabled-device allowlist, exact device IDs, disconnect
  persistence, inherited binding overrides, additive same-address fan-out, and
  missing-target behavior.
- Edit/Perform tests cover structural locks, volatile runtime values, Capture
  destinations and previews, undo/dirty behavior, save failure, and root-state
  Capture.
- Activation state-machine tests cover validation, single commit, stale
  generations, preparation and Plug-in restore failure, retained old graphs,
  root reactivation, all-notes-off, bounded click-free cut, and post-activation
  instance containment.
- Architecture tests reject Live timeline/media tables, cross-document table
  copying, arbitrary SQL transport, executable UI content, and audio-callback
  persistence or allocation.
- Manual release evidence covers missing/replaced devices, repeated Patch/root
  switching, strict MIDI rigs, Plug-in failure, Save/Capture under load, and a
  two-hour performance session without an unexplained XRUN or unbounded trend.

## Reconsider when

Replace this ADR if field-level inheritance cannot express real performance
sets, strict physical-device identity prevents the supported deployment model,
PGlite cannot meet measured Patch/save latency, or users demonstrate a need for
linked Studio/Live synchronization, nested Sets, executable UI, or a timeline
that cannot be represented as a bounded Live playback capability.
