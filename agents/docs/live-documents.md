# Live documents

This document owns the standalone Live design and its current implementation
boundaries. [The roadmap](roadmap.md#current--live-project-delivery) owns delivery
and evidence status; [the performance contract](product-live.md) owns the live
readiness baseline. [ADR-0004](adr/0004-layered-live-documents.md) explains the
choice of separate documents with a shared Mixer.

## Document and persistence ownership

Studio defaults to `.hrs` and also opens/saves `.heron` in place. Live uses `.hrl`.
The persisted kind marker is authoritative; mismatched kind/extension and
unsupported newer formats produce typed errors. Supported older formats migrate
in working copies and replace source archives only on Save. A recognized unmarked
Studio archive acquires its marker through that migration path.

Studio and Live have independent PGlite schemas, templates, workers, migration
journals and recovery. Shared Mixer tables/readers do not depend on Studio tracks,
clips, media or musical maps. A shared table change generates a migration in each
affected lineage; shared tables do not make archives or journals interchangeable.
Each document kind can declare stability independently. The current development
formats have no general compatibility guarantee; after stability, migrations are
append-only. See [database rules](project-database.md).

The implemented Live editor persists Project-owned Mixer entities and MIDI
configuration, Set/Patch scalar overrides, complete plug-in state and parameter
overrides. Root and hierarchy edits share one revision, worker transaction and
Undo entry. Save and recovery include the complete hierarchy. Version 2 added
scalar layers to version 1; version 3 added state headers/binary chunks. Those
supported upgrades do not establish blanket pre-1.0 compatibility. State headers
preserve an explicit empty envelope, and bytes never enter scalar JSON or base64.
The working-copy marker advances before state writes are admitted.

## Layers and editing

The design hierarchy is Project → Set → Patch. Sets cannot nest and are
non-activatable overlays. Opening selects Project for editing and has no active
Patch. Resolve Project, containing Set and Patch afresh; previous-Patch values
never leak into another resolution. Local editing selection does not dirty the
document or activate audio. Edit is currently silent.

Overrides are per field. Absence inherits; explicit equality still owns a value;
explicit null is distinct wherever the field policy permits it. Ordinary edits
write to the nearest defining layer. **Override here** creates an explicit value
in the selected layer; **Revert** removes only that override. The UI identifies
both the defining layer and affected descendants. Field policy is versioned
shared domain logic, never user-defined archive rules.

Current scalar overrides cover channel Gain/Pan/Mute/Solo, Send level/enable,
plug-in enablement and stable plug-in parameter keys. Routing, structure, physical
I/O and device configuration remain Project-owned. Every edit validates all
resolved descendants, including unselected layers. Deleting or replacing a root
target with dependent scalar or state overrides is refused until they are
explicitly reverted. General recursive entity deletion remains delivery work.

Copy creates fresh layer IDs and preserves explicit overrides and Project
references. Set copy includes its Patches. A copied Patch inherits from its
new containing Set. Layer deletion previews the subtree and override counts,
then commits one undoable change.

Complete state is an indivisible per-plug-in field independent of each parameter
key. **Override here** copies effective state; empty and equal states still own
an override. Copy, deletion, Undo/Redo and recovery preserve these records.
Resolve the nearest state, restore it, then apply effective parameter overrides.
Creating/reverting state never removes parameter overrides implicitly.

## Perform and activation

Entering Perform activates Project after synchronizing pending Edit state and
preparing the complete graph against the document's exact backend/device IDs,
sample rate and configuration. Missing audio blocks Perform while allowing Edit
and Save. MIDI instrument inputs must name enabled physical devices; wildcard
input does not opt every device into Live. Missing MIDI leaves its bindings
unavailable without blocking unrelated audio. There is no arbitrary/default
device fallback. Patch changes retain running device streams.

The explicit Live runtime adapter uses the embedded host and existing graph
transactions. It loads fresh native instances for every activation, restores
state and then parameters, and owns at most one candidate deployment. The latest
selection has authority until submission to the native commit boundary. A
submitted activation must be reconciled before another candidate can commit.
Publish active selection and generation only after confirmed activation. Known
preparation failures release candidates and preserve the previous graph;
unknown outcomes retain ownership and quarantine mutations until shutdown and
cleanup are confirmed. Never unload a possibly committed candidate speculatively.

The callback executes the prepared bounded `cut`: short outgoing/incoming gain
ramps, note and sustain release, no new MIDI into the outgoing graph, and bounded
retirement after its last render. No allocation or transition preparation occurs
in the callback. This does not implement cross-Patch tails or sustain.

During Perform, structure, routing, devices and Undo/Redo are locked. Gain, Pan,
Mute, Solo, Send level/enable, plug-in enable and parameters are volatile runtime
controls; they do not redeploy the graph, dirty the document or create Undo.
Commands identify the document, operation, expected revision and active runtime
generation. Stale gestures and outgoing-instance events cannot affect a new
Patch. Snapshots map stable document IDs to generation-specific native IDs.
Studio recovery cannot republish a graph while Live owns the workspace.

## Save, Capture and exit

Save serializes the document baseline; it never samples Perform state. Capture
freezes runtime generation, active Patch, document revision, values and selectable
fields in a replayable preview. Changes after the preview remain volatile.
Selected scalars write to their defining layers. Each complete-state selection
at a Patch explicitly names its defining layer or a new override at the active
Patch; Project Capture permits only Project. Reject duplicate, extra, unavailable
or unrelated destinations before persistence.

The preview defaults to the defining layer and labels the affected scope.
Complete state can include unchecked parameter values inside opaque bytes;
separate saved parameter overrides still apply after restoration. Ancestor
Capture affects inheriting descendants; an active-Patch override preserves
ancestor/sibling records. All selected fields commit in one worker transaction
and one Undo entry without changing native state. Failure preserves the sound.
Compare normalized state/chunk order when reconciling an ambiguous worker result.
A successful Capture requires a new preview for any remaining changes.

Patch switching, leaving Perform and document close offer Capture, discard or
cancel for volatile changes. Capture completes before retrying the transition;
cancel preserves Perform. Ordinary unsaved document edits have their own
save/discard/cancel decision. Returning to Edit stops and releases Live audio;
subsequent Perform prepares fresh baseline instances. The earlier root bootstrap
plan for Edit audition does not describe the current silent Edit path.

Known command receipts replay even after revision advancement. Renderer retries
retain operation identity until a terminal result, then acknowledge to release
bounded capacity. Revision conflicts refresh the workspace; unreadable or
different committed results quarantine it. Quarantine preserves the working
copy and offers **Close and recover**, refusing ordinary Save/discard. Pending
operations reconcile before close, and runtime shutdown precedes worker cleanup.

Close retains its context until worker exit is confirmed. After exit, close is
committed even if later cleanup fails. Discard marks a working copy ineligible
before removing its database. Ambiguous exit allows only recovery cleanup.

## Accepted design still awaiting delivery

These commitments remain part of the Live design; this document does not claim
the following scope is implemented:

- Each entity has one owning layer. Project entities are global, Set entities
  visible in that Set and its Patches, and Patch entities local. Master, Output,
  hardware and physical I/O remain Project-owned. Child layers may eventually
  create Audio/Instrument/Aux Channels, Sends, bindings and UI entities.
- Plug-ins share Channel ownership. Children cannot add/remove/replace/reorder an
  inherited chain or override descriptor, slot ownership, sidechain structure,
  layout or alias. They may override the supported state and parameter fields.
- References point only to the same layer or ancestors. A child route override
  may target a child-owned destination. Cross-Set copy rejects unresolved source
  Set references; it never guesses or imports missing dependencies.
- Owner deletion computes and previews the recursive dependency closure,
  overrides, fallbacks and required retargeting, then commits atomically. Children
  cannot delete inherited entities. Entities/layers cannot move between scopes.
- Import creates a new Live document from one typed Mixer projection of a
  migrated Studio archive, remaps IDs and validates/inserts in one transaction.
  It copies no tables, journals, global settings or Studio history. There is no
  source linkage, synchronization, write-back or full merge into an existing Live.
- Layer-owned stable-ID MIDI bindings use enabled physical devices. Same-address
  bindings add visible fan-out; descendants may override inherited bindings.
  Studio application-owned mappings retain their separate contract.
- Performance UI is validated versioned declarative data obeying scope rules.
  Archives cannot contain executable HTML, JavaScript or Vue components. Unknown
  components/targets are visibly unavailable without blocking Edit. Its concrete
  vocabulary remains deferred.

Scoped entities, routing/binding overrides, MIDI control execution, Live plug-in
editors, Edit audition, Studio import and the full deletion workflow remain in
the roadmap. Studio-only arrangement, clips, media, recording, automation and
musical timelines do not enter Live implicitly. Future playback, Clock,
preloading/residency and tail-preserving transitions need explicit product scope.
Native, failure-path, click and real-hardware soak evidence remain delivery gates.
