# ADR-0016: Independent volatile plug-in measurement sessions

- Status: Accepted
- Date: 2026-10-04
- Owners: project maintainers
- Current specification: [owning document](../plugin-analysis.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0016-plugin-analysis.md)

## Context

Measurement needs controlled excitation and frozen plug-in state without editing
a project or claiming an audio device. Native processor clones can share state,
so live instances cannot safely double as disposable experiments.

## Decision

Use an independent secure Electron renderer with narrow session authority.
Original and disposable measurement instances share the existing embedded host
but have independent identities and lifetimes. A bounded native worker processes
measurements; same-revision results publish only after terminal cleanup. Retained
receipts, generations and quarantine establish ownership after failure. Offline
analysis adds neither a helper nor device callback work.

## Alternatives and consequences

Reusing project state would couple experimentation to creative data. Shared
processor handles would not freeze state. Device output would constrain overload
experiments and device ownership unnecessarily. Same-process measurement retains
the host's fatal-fault boundary and cannot preempt a third-party call.

Two-chain comparison, current measurement algorithms, plot coordinates, display
limits and fitting now live in the owning feature documents. Their evolution
within this ownership contract does not itself need a replacement ADR.

## Reconsider when

Measurement requires external hardware, durable sessions, independently hosted
processing or a different cancellation/failure boundary.
