# ADR-0013: Persist sparse Live Set and Patch edits

- Status: Accepted
- Date: 2026-10-02
- Owners: project maintainers
- Related: [ADR-0004](0004-layered-live-documents.md),
  [ADR-0008](0008-root-live-bootstrap-and-capture.md)

## Context

Live has a revisioned root Mixer editor and an independent archive, but no
editable Set/Patch hierarchy. The runtime port for audition and Perform remains
unconnected. Layer authoring can advance independently if selecting an editing
scope never implies that an audio graph has been activated.

## Decision

Deliver Project → Set → Patch authoring with named, ordered Sets and Patches.
The editing selection is local workspace state, resets to Project on opening a
document, and does not dirty the document. Sets remain non-activatable. No active
Patch or runtime generation is published by selecting an editing layer.

In this stage, all Mixer entities and MIDI bindings remain Project-owned. Sets
and Patches store sparse overrides for channel Gain, Pan, Mute and Solo, Send
level and enabled state, plug-in enabled state, and stable plug-in parameter
values. Structural editing, routing, physical I/O and device configuration stay
at Project. Scoped entities, binding overrides, nullable routing fields and
opaque plug-in state overrides remain later parts of ADR-0004. The field policy
is expressed in shared types and validation, never user-defined archive rules.

Resolve a selected layer afresh from the Project baseline, then its Set and
Patch overrides. An explicit override equal to its parent remains an override.
Revert removes that field from the current layer. Ordinary scalar Mixer edits
write to the nearest layer already defining each field; explicitly creating an
override claims only that field at the selected layer. The UI exposes the
defining scope and explains which descendants an ordinary edit affects.

Persist Sets and Patches in separate Live tables, with validated typed scalar
override arrays. They participate in the same revision and transaction as the
root Mixer. Undo/Redo restores the complete root and hierarchy together. Save
and working-copy recovery include the hierarchy. Validate every effective layer
before committing a root or layer edit, including layers not currently selected.
Deleting a root target or replacing a plug-in with dependent overrides is refused
until those overrides have been explicitly reverted; general recursive entity
deletion with route replacement remains future work.

Copy creates fresh layer IDs and preserves references to Project entities.
Copying a Set includes its Patch subtree. Copying a Patch copies its explicit
overrides; inherited values resolve from the destination Set. This stage has no
Set-owned entity references that could escape a cross-Set copy. Adding such
entities requires the dependency checks in ADR-0004 before extending Copy.
Deleting a layer previews the affected Sets, Patches and override counts, then
commits their removal in one undoable transaction.

The Live format advances from 1 to 2 with a generated additive migration.
Opening a supported version-1 archive upgrades only its working copy; saving
writes version 2. Older writers reject version 2 instead of discarding layers.
This specific upgrade does not establish general pre-1.0 format stability.
Unsupported newer versions are rejected before migrations run.

Worker acknowledgement loss is reconciled against revision, root baseline and
the complete hierarchy. A different or unreadable committed result quarantines
the session. A repeated IPC mutation returns its recorded result even after
the document revision has advanced. Renderer mutations retain their original
operation identity until a terminal outcome can be replayed, and acknowledge
known results to release bounded registry capacity. Explicit revision conflicts
refresh the workspace; they are not ambiguous commits.

Quarantine marks the working copy recoverable and locks further edits. The
typed Live close disposition `preserve` closes the worker without writing the
archive or deleting the working copy. The UI offers **Close and recover**;
reopening presents the existing saved-versus-working-copy decision. Save and
discard are refused while quarantined. A still-running operation must be
reconciled before close can proceed.

## Alternatives rejected

- Full Mixer snapshots per Patch would accidentally freeze inherited fields.
- Storing the hierarchy in renderer preferences would lose it during archive
  transfer and break document Undo and recovery.
- Calling editing selection activation would imply audio that has not committed.
- Deleting dependent overrides implicitly would discard authored Patch intent.

## Consequences

Users can prepare reusable Mixer variations while audition, Perform, Capture,
scoped entities and complete recursive entity deletion remain delivery work.
Root edits must validate all descendant resolutions. The scalar-only schema
avoids opaque binary state in JSON and has no nullable field semantics yet.

## Verification

Verify inheritance and explicit equality, nearest defining scope, Revert,
fresh resolution across sibling Patches, validated Copy, subtree deletion,
transaction rollback, Undo/Redo, archive and working-copy round trips,
version-1 upgrade, newer-version rejection, and lost acknowledgement handling.
Renderer tests cover editing selection, effective Mixer values, explicit override
intent, deletion confirmation, and selection recovery after Undo or deletion.
Actual Patch activation still requires the runtime and hardware evidence in
ADR-0004 and ADR-0008.

## Reconsider when

Layer-owned channels or bindings, opaque state overrides, or runtime activation
are implemented, or measured document sizes require a different override storage
representation.
