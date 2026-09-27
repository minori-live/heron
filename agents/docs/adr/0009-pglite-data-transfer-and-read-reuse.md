# ADR-0009: PGlite binary transfer and bounded project reads

Status: Accepted\
Date: 2026-09-27\
Owner: Heron maintainers

## Context

The PGlite audit found expensive text bytea conversion, repeated materialization
of unchanged MIDI and plug-in payloads, unbounded bind parameter batches, and
asset lists that fetched entire MIDI files only to count their bytes. Small
commands must retain the existing transaction and delivery-reconciliation
guarantees while avoiding work proportional to unrelated binary payloads.

## Decision

Keep worker-owned PGlite, Drizzle transactions, PostgreSQL large objects, and the
existing project archive format. Use PGlite's public virtual filesystem APIs for
large-object binary transfer. Private, uniquely named temporary paths live outside
PGDATA. SQL receives parameterized paths and OIDs, and temporary files are removed
on success, failure, or cancellation. A temporary file is not a durable commit;
the enclosing database transaction remains the asset commit point.

Do not handcraft the PostgreSQL wire protocol or bypass PGlite's transaction mutex
to obtain binary results. Binary infrastructure is local to project-db and must
not expose paths, SQL, or arbitrary file operations to the renderer.

Reuse unchanged MIDI content and plug-in state rows within a ProjectDatabase
instance. Always reread graph metadata and decode descriptors inside the command
transaction. Mutations invalidate affected payloads before reading their resulting
snapshot. MIDI edits reread only affected clips; cascades and oversized clip-ID
sets may fall back to a full read. Tentative reads become reusable only after commit; failed transactions
must not publish tentative content. Closing or reopening starts with an empty
cache. Returned byte arrays cannot mutate cached database state.

ProjectDatabase serializes payload reads and mutations even for direct callers,
so concurrent snapshots cannot publish an older cache after a later mutation.
The worker continues to serialize operations. Full graph response shapes,
prepared tokens, commit status, acknowledgement ownership, quarantine behavior,
and native graph publication remain unchanged. This change reduces database
materialization; it does not claim to eliminate every graph copy across IPC.

Bound MIDI inserts and ID lists below PostgreSQL's bind parameter limit while
keeping all chunks in the same transaction. Combine adjacent equal note patches
without changing the order of different patches. Express clip rebasing as
parameterized arithmetic in typed Drizzle updates.

Asset listings select byte length in PostgreSQL instead of reading the payload.
Named content-hash lookups serve import deduplication. Permit narrowly owned
Drizzle expressions for these calculations, in addition to binary file transfer;
do not reopen a general raw SQL interface.

## Alternatives

- Faster hex codecs alone leave media unnecessarily expanded into text. They may
  be useful for residual bytea values but are not the large-object transport.
- A private binary serializer cast or custom raw-wire executor would couple
  correctness to unsupported driver behavior and transaction internals.
- Removing the transaction's resulting snapshot would weaken rollback and status
  reconciliation. Reusing only unchanged payload rows preserves metadata checks.
- Replacing persistence or changing archive format would introduce unrelated
  compatibility and recovery work before addressing measured local overhead.

## Consequences and verification

Binary transfer tests must cover byte equality, subviews, empty content, cleanup,
failure, cancellation, and transaction rollback. Cache tests must cover invalidation,
rollback, caller mutation isolation, and external metadata corruption checks.
MIDI boundary tests must exceed 65,535 total parameters and fail in a later chunk
without partial persistence. Archive reopening and orphan cleanup remain real
disk tests; ordinary repository tests may use isolated real in-memory PGlite.

Performance evidence must distinguish database API latency from Electron/native
end-to-end latency. Reconsider IPC graph shape and media storage only if remaining
copying or queue wait measurements justify that separate protocol change.
