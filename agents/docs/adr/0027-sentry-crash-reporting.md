# ADR-0027: Consent-gated crash reporting in Electron main

- Status: Proposed
- Date: 2026-10-06
- Owners: project maintainers
- Current specification: [owning document](../crash-reporting.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0027-sentry-crash-reporting.md)

## Context

The embedded addon can terminate Electron main before JavaScript reports a fault.
Explicit diagnostics consent must govern uploads, including dumps surviving a
crash or later revocation.

## Proposed decision

Let Electron main own minimal Sentry/Crashpad initialization before addon loading.
Keep reporting out of Rust, preload, renderer and audio callbacks. Initialize only
under explicit committed consent and production authority. Enable on next launch,
latch revocation for the current run, and segregate dump caches by consent epoch.
Never attach projects/recordings or claim minidumps contain no sensitive memory.

## Alternatives and consequences if accepted

A second native SDK risks conflicting signal handlers and real-time work.
Immediate opt-in cannot establish a clean boundary from old Crashpad state;
restart/epochs do. Packaging or an environment label alone cannot exclude copied
consent in a test run. Runtime endpoint overrides can accidentally target a real
service; isolated verification needs bounded inert/local transport.

Reporting depends on matching application symbols and external upload credentials.
Native reports may wait for a later launch; pre-initialization crashes remain
outside coverage. Revocation cannot recall already dispatched HTTP. The later
restart/environment-isolation proposal is consolidated into this rationale and
the current operations document. Plug-in symbol integration remains deferred.

The historical status remains Proposed. Source implementation documented in the
operations guide is not a retroactive acceptance or production-validation claim.

## Reconsider when

Immediate opt-in, performance/renderer telemetry, caught panics, probe crashes,
offline delivery or nonproduction distribution becomes a product requirement.
