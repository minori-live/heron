# ADR-0003: Separate MIDI control from observation

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Current specification: [owning document](../midi-control.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0003-midi-control-and-observation.md)

## Context

Controls need prompt bounded delivery; chord displays need recoverable current
state. Neither UI naming nor one project-history entry per hardware event belongs
in the audio callback. Global mappings must not retain transient project handles.

## Decision

Deliver hardware control through a bounded event queue and coalesced wake, while
sampling active-note snapshots independently for display. Studio preferences use
physical MIDI identity and semantic targets: visible Mixer order or plug-in alias
plus parameter key. Continuous hardware edits occupy an overlay/runtime state and
save atomically without adding Undo per event. Live document-owned bindings remain
part of its separate layered design.

## Alternatives and consequences

Faster polling still couples control latency to a presentation timer. Streaming
every display event requires unnecessary replay machinery. Persisting project IDs
or silently retargeting missing mappings makes hardware meanings unstable.
Visible-order addressing deliberately changes when channels are reordered; short
notes may be absent from a state display without being lost from control delivery.

## Reconsider when

Banking, takeover or feedback require new gesture semantics, or measured display
loss/overhead justifies an ordered observation stream.
