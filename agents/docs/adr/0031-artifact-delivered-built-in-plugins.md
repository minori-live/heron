# ADR-0031: Consume independently released built-in plug-ins

- Status: Accepted
- Date: 2026-10-10
- Owners: project maintainers
- Current specification: [owning document](../builtin-plugin-distribution.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0031-artifact-delivered-built-in-plugins.md)

## Context

Compiling built-ins inside Heron coupled source ownership, packaging and release
cadence. Saved projects already depend on stable built-in identities, parameters
and opaque state, so extracting their producer must preserve those commitments.

## Decision

`heron-plugins` owns plug-in sources, DSP/editor/toolkit code, format exports and
suite releases. Heron owns host/probes, metronome scheduling and artifact integration.
Consume validated pinned runtime VST3 bundles; source compilation is not a fallback.
Inventory comes from the installed manifest and actual capabilities from probes.
Plug-in upgrades enter through reviewed application dependency updates.

## Alternatives and consequences

Git/submodule builds preserve compilation coupling instead of consuming validated
producer output. Independent runtime binary updates require additional replacement,
recovery and compatibility protocols. Release dependencies require producer assets
before consumer builds and explicit signing/synchronization configuration. Missing
inventory cannot erase saved identity or state.

The later artifact-identity and runtime-only amendments are maintained in the
current distribution contract: version/source/runtime filenames define the lock;
Heron does not consume plug-in symbols. Application crash reporting remains
separate. EQ processing/editor rules are owned by the producer; Heron's integration
notes retain fitted-preset and project compatibility, avoiding a second evolving
plug-in specification in host ADRs.

## Reconsider when

Plug-ins need independent runtime updates, new internal formats or telemetry with
a new privacy/real-time contract.
