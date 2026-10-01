# ADR-0015: Persist and capture complete plug-in state in Live layers

- Status: Accepted
- Date: 2026-10-02
- Owners: project maintainers
- Related: [ADR-0004](0004-layered-live-documents.md),
  [ADR-0013](0013-live-layer-editing.md),
  [ADR-0014](0014-live-runtime-activation.md)

## Context

Scalar overrides alone cannot preserve a Patch's program, sample selection or
other opaque plug-in state. ADR-0014 therefore blocked complete state Capture
from Patches. Serializing state bytes into scalar override JSON would lose the
existing binary storage contract. Capturing a resolved Patch into an ancestor
also needs an explicit scope: opaque state may contain parameter values that
were previously specific to that Patch.

## Decision

Each Set and Patch may store a complete state override per Project plug-in ID.
The field is indivisible. Absence inherits; an explicit empty envelope overrides
the inherited state. Equal values still establish ownership. **Override here**
copies the effective state into the selected layer; **Revert** removes that
layer's state record. Copy, deletion, Undo/Redo and recovery include these records.
Replacing or deleting a plug-in with dependent state overrides is rejected until
those overrides are reverted.

Resolve the nearest complete state independently of every stable parameter key.
Runtime preparation restores the winning state and then applies all effective
parameter overrides. Creating or reverting a state override never silently
removes parameter overrides. Activation continues to use fresh native instances.
The existing runtime generation and graph commit boundaries are unchanged.

CLAP candidate preparation flushes queued parameter values before establishing
the initial saved-state and parameter baseline. This is permitted only while
the registry owns the sole processor lease: the owning main thread deactivates
the unpublished instance, flushes parameters, then reactivates it. Prepared,
active or retiring graph leases prevent this path. It follows CLAP's
[inactive parameter flush contract](https://github.com/free-audio/clap/blob/main/include/clap/ext/params.h)
without rendering the candidate or adding callback work.

Live format 3 adds Set/Patch state headers and binary chunk tables with physical
foreign keys and Drizzle relations. A header preserves an empty envelope. Bytes
use the established bytea codec, never JSON or base64. The additive migration
leaves earlier scalar layers unchanged. The working copy's format marker advances
before it can accept state writes; saving produces an archive older writers must
reject. Root and all layer writes share the existing revision transaction.

Capture keeps its frozen preview, document revision and runtime generation.
Every selected complete-state field at a Patch supplies an explicit destination:
its existing defining layer or the active Patch. The dialog initially selects
the defining layer, labels the affected scope, and offers creation of an override
in the active Patch. Project Capture permits only Project. Duplicate, extra,
unavailable or unrelated destinations are rejected before persistence. Scalar
Capture continues to write each field to its defining layer.

Complete state may embed parameter values, even when the corresponding separate
parameter field is unchecked. The preview explains this and that existing saved
parameter overrides apply after state restoration. Selecting complete state is
an explicit request for that indivisible payload; Heron cannot selectively edit
unknown plug-in bytes. Writing to Project or Set affects descendants inheriting
that state. Creating a state override in the active Patch preserves ancestor and
sibling state records.

All selected fields and destinations commit in one worker transaction and one
Undo entry. No native state is changed by Capture. A failed commit preserves the
running Patch; ambiguous results use the existing persisted-baseline comparison
and quarantine path. State comparison normalizes plug-in and chunk ordering so
database read ordering cannot turn a committed write into an unknown outcome.

## Consequences

Patch complete-state Capture is available without changing plug-in ownership or
allowing child layers to replace inherited chains. Stored parameter overrides
can intentionally take precedence over a newly captured program. Edit audition,
plug-in editors and Live MIDI bindings remain separate work; this decision does
not claim those workflows or real-device performance validation are complete.

## Verification requirements

Required evidence includes empty/equal/inherited state, independent parameter
precedence, scoped Capture and sibling preservation, binary archive round trips,
revision conflicts, failed writes, Undo/Redo, worker-result reconciliation and
activation with real plug-ins. Type checking and builds alone do not establish
these runtime and persistence outcomes.
