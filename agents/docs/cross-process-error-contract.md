# Renderer/main resource and error contract

The only application-owned cross-process boundary is renderer/preload to
Electron main. Native audio calls from main are in-process N-API calls.

Renderer RPC uses serializable success/error unions, explicit resource refs,
expected revisions, and correlation IDs. Stateful mutations have one commit
point, prepare/abort cleanup where needed, and reconciliation for ambiguous
renderer/main delivery outcomes. Do not use rejected promises, ambient current
resources, Rust panics, or free-form strings as protocol semantics.

The embedded audio protocol keeps typed Rust control results. Main translates
native request failures into the existing RPC error union before crossing back
to the renderer. Native request serialization must not introduce helper
process epochs, attachment leases, OS handles, or restart status.

Resource epochs remain useful even without an audio helper: they distinguish a
renderer command created for an older project/native session from the current
one. On application relaunch all renderer state is rebuilt through bootstrap;
there is no in-process audio-host recovery transaction.

Project command responses have an explicit retention owner. The database
worker keeps a committed response until main has recorded it; main keeps it
until its caller acknowledges a known terminal outcome. Renderer graph
commands retry undelivered acknowledgements on subsequent interactions.
Native editor requests are acknowledged by their main-process caller.
Unknown outcomes cannot be acknowledged away and quarantine the affected
graph; a matching retry returns the retained result even after quarantine.
Reopening establishes a new authoritative project workspace. See
[ADR-0001](adr/0001-runtime-ownership-and-transactions.md).
