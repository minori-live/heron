# ADR-0006: Explicit installation from published releases

- Status: Accepted
- Date: 2026-09-06
- Amended: 2026-09-26
- Owners: project maintainers
- Current specification: [owning document](../application-updates.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0006-tagged-release-updates.md)

## Context

Updates must preserve save cancellation and audio shutdown. Downloading an
installer must not authorize installation or enable updates in development builds.

## Decision

Use the locked Electron updater/packaging stack for installed tagged releases,
with Pages channel metadata referring to immutable GitHub Release assets. Main
owns scheduling, bounded admission receipts and shutdown. Only an explicit restart
and update action can install after project closure and confirmed service cleanup.
Publishing a draft is separate from promoting the feed.

## Alternatives and consequences

Electron's direct updater lacks the chosen Linux integration; a separate server
adds operations ownership. Installing automatically on quit conflicts with save
cancellation and audio work. Pages and GitHub availability, signed macOS packages
and compatible distribution metadata remain dependencies. Historical clients
using the older GitHub provider need a manual transition into the Pages feed.
Installed-upgrade evidence is distinct from unit coverage.

## Reconsider when

Distribution infrastructure, channel policy, signing or updater support requires
a different ownership or installation contract.
