# ADR-0011: One owner for the native wire shape

- Status: Accepted
- Date: 2026-09-30
- Owners: project maintainers
- Current specification: [owning document](../architecture.md#native-wire-model-ownership)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0011-protocol-owns-the-wire-shape.md)

## Context

Parallel native models and handwritten TypeScript interfaces allowed both sides
to compile while disagreeing on serialized fields. Identity converters obscured
which layer actually owned the contract.

## Decision

The Rust protocol owns native wire shapes and generated TypeScript declarations.
Resolved engine state carries actual runtime identities/handles; real-time state
carries callback-safe structures. Serialization stays out of the engine and no
parallel serialized model is maintained by hand. Database structural ownership
continues to belong to Drizzle.

## Alternatives and consequences

Generating converters between duplicate models retains duplicate concepts.
Moving atomics/trait objects into the wire layer makes persistence depend on runtime
state. Handwritten mirrors plus review permit drift. Generation adds an explicit
export/check step while preserving distinct resolved representations where needed.
The former file-by-file migration inventory is implementation history, not a
permanent exception to ownership rules.

## Reconsider when

A boundary requires validation that generated declarations cannot express, or the
actual resolved-state needs change enough to justify a different representation.
