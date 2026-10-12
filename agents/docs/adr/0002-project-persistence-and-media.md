# ADR-0002: Self-contained projects and canonical media

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Current specification: [owning document](../project-database.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0002-project-persistence-and-media.md)

## Context

Portable projects need atomic edits, reliable media and recoverable working
copies. External compressed assets couple playback to paths and repeated decoding;
replaying all historical migrations also makes new-project creation grow slower.

## Decision

Keep PGlite/Drizzle in the owning worker, with typed domain operations instead of
a SQL proxy. Projects own their media and use physical PGlite archives. Canonical
audio preparation happens outside the callback. New documents load a schema-only
build template and seed runtime values atomically; supported existing documents
migrate their working copies before Save replaces the archive.

## Alternatives and consequences

External media weakens portability. A fully seeded build artifact captures runtime
identity; copying raw directories bypasses the archive boundary. A separate global
media library adds scanning/persistence obligations beyond project-local assets.
Canonical audio costs space and build templates require packaging discipline.
The independent Studio/Live lineages remain the choice in
[ADR-0004](0004-layered-live-documents.md), not interchangeable database journals.

## Reconsider when

A measured workload or PGlite format change justifies logical snapshots or another
storage representation with explicit compatibility and recovery behavior.
