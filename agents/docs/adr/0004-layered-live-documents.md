# ADR-0004: Standalone layered Live documents on the shared Mixer

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Current specification: [owning document](../live-documents.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0004-layered-live-documents.md)

## Context

Studio carries arrangement, media, recording and musical maps. Live needs a Mixer
baseline with reusable performance variations. Keeping everything in one archive
would retain unrelated state; a separate Mixer would duplicate routing/plug-in
semantics and make import lossy.

## Decision

Use independent Studio/Live documents and persistence lineages over one shared
Mixer. Live has Project → Set → Patch ownership and sparse field inheritance;
Sets are non-activatable overlays, Patches activatable leaves, and Project is a
valid runtime selection. Exact hardware belongs to the document. Future import
is a one-time typed projection with remapped identities, not a linked source.

Perform controls stay volatile until explicit selective Capture. Save writes the
baseline. Resolve and prepare fresh effective state, then publish selection only
after one graph commit. The initial transition is bounded cut. Performance UI is
validated declarative data, not executable archive content.

## Alternatives and consequences

A single Studio/Live archive blurs save behavior. Complete snapshots per Patch
freeze parent values accidentally. Linked imports need conflict/ancestry rules;
nested or movable Sets complicate reference scope. Set-based preload improperly
ties storage hierarchy to runtime memory policy. A separate persistence stack or
executable UI adds recovery and trust obligations.

This choice costs independent migration/recovery matrices and explicit rig
reconfiguration. Activation can take time while the old graph remains authoritative.
The root bootstrap, scalar layer, runtime and opaque-state delivery steps formerly
recorded separately are now maintained together in the current specification.
Acceptance of this design does not establish completion of scoped entities,
Studio import, declarative UI or hardware evidence; see the roadmap.

## Reconsider when

Real performances require another ownership model, linked synchronization,
residency, seamless transitions or executable content with justified boundaries.
