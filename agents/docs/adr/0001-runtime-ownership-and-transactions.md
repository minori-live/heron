# ADR-0001: Embedded runtime and explicit commits

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Current specification: [owning document](../architecture.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0001-runtime-ownership-and-transactions.md)

## Context

Audio, ARA, editors and project mutations need explicit owners. A supervised
helper introduces transport, window and recovery machinery that conflicts with
the chosen in-process ARA integration. A returned error or lost response also
cannot establish whether a mutation committed.

## Decision

Electron main owns the embedded native runtime and platform UI loop. Rust owns
audio, device streams and bounded control/real-time state. Renderer/preload use
explicit typed resources; the local native envelope is an ABI, not another
process transport. Stateful operations prepare, commit once, abort known failures
and reconcile unknown outcomes through retained results and generations.

Contain returned plug-in failures while retaining project intent and committed
state. Fatal native faults can terminate main; this architecture does not promise
crash isolation or uninterrupted audio. Recovery after relaunch uses saved versus
recoverable working copies. Explicit user choices outrank stale automatic recovery.

## Alternatives and consequences

A helper or per-plug-in process would require a different ARA/editor and real-time
ownership model. Treating every returned error as fatal needlessly interrupts
unrelated paths. Last-completion-wins recovery can override user intent; dropping
receipts loses commit reconciliation. The chosen model keeps one runtime and
bounded transfer of responsibility, but cannot preempt arbitrary third-party calls.

## Reconsider when

Measured contention or a product requirement for process isolation justifies a
complete replacement preserving ARA, editor lifetime, real-time bounds and commits.
