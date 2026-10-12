# Agent Development Notes

This directory holds project and agent-facing documentation that is too detailed
for the repository-level `AGENTS.md`.

Use it for architecture, roadmap, performance, CI, design-system notes,
development-environment guidance, agent workflows, permission guidance,
implementation checklists, and other automation-specific conventions. Manage
reusable agent skills through `apm.yml` rather than documenting or editing
installed copies under `.agents/skills/`.

Native plugin development is owned by
[Heron Plugins' local standards](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/README.md).
Its engineering, testing, architecture, environment and native UI rules were
migrated and adapted from this documentation on 2026-10-10. Maintain plugin
DSP/editor contracts there; this repository continues to own application,
audio-host and artifact-consumer rules. Shared engineering principles remain
local in each repository so either can be developed independently.

## Notes

- [Architecture and real-time constraints](architecture.md)
- [Architecture decision records](adr/README.md)
- [Product roadmap](roadmap.md)
- [Live document design and implementation scope](live-documents.md)
- [MIDI control and observation](midi-control.md)
- [Application preferences and onboarding](application-preferences.md)
- [Application updates](application-updates.md)
- [Plugin Analysis](plugin-analysis.md)
- [VST3 hosting contracts](vst3-hosting.md)
- [Live performance product contract](product-live.md)
- [Engineering standards](engineering-standards.md)
- [Testing policy](testing.md)
- [Product interaction design](interaction-design.md)
- [Rust performance benchmarks](benchmarks.md)
- [Continuous integration and releases](ci.md)
- [Built-in plug-in distribution](builtin-plugin-distribution.md)
- [EQ host integration and fitted-preset interchange](heron-eq.md)
- [Plugin development standards](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/README.md)
- [Legacy built-in project fixture](legacy-builtin-project-fixture.md)
- [Crash reporting operations](crash-reporting.md)
- [Design system](design-system.md)
- [Desktop localization](localization.md)
- [Development environment](environment.md)
- [Native call boundary](native-call-boundary.md)
- [Transactions and plug-in containment](architecture.md#project-command-receipts-and-admission)
- [Project database development rules](project-database.md)

## Authority

`AGENTS.md` is the concise repository entry point. These documents are the
normative detail behind it. The roadmap orders user outcomes; the Live product
contract defines the v0.5.0 performance baseline; architecture and feature
documents define current ownership and design; engineering standards govern
code and tests; interaction design governs workflow behavior; and the design
system governs visual primitives and accessibility. ADRs preserve the rationale
for durable choices. The [ADR index](adr/README.md#2026-10-12-consolidation) maps
historical records to current owners. Creation, acceptance and revisions follow
[ADR governance](adr/README.md).

The public `docs/` workspace describes behavior that is already available to
users. Do not use public documentation to announce unimplemented roadmap scope.

## Adoption and precedence

These rules are adopted for all new work and all materially changed code or
behavior from 2026-08-08 onward. Existing code is not evidence that a conflicting
pattern is still permitted. When a change touches non-conforming code, either
bring the affected scope into compliance or link a narrowly scoped tracking
issue or policy exception.

Apply the documents by responsibility:

1. [Engineering standards](engineering-standards.md) govern implementation,
   testing, review evidence, errors, module cohesion, and exceptions.
2. [Architecture](architecture.md) governs current ownership, dependency
   direction, process/thread boundaries, protocols, and real-time assumptions.
3. [Interaction design](interaction-design.md) governs product workflow,
   control exposure, feedback, recovery, and Logic-compatible behavior.
4. [Accepted ADRs](adr/README.md) preserve durable decisions and explain why
   the current architecture or interaction rule exists.

The roadmap decides sequencing but does not waive these rules. A proposed ADR
is not authority. Maintain current rules in the owning documents as part of
authorized work. Historical implementation details in an ADR do not independently
freeze the current design; clarify misleading details with a dated amendment
and a link as described in [ADR governance](adr/README.md). Genuine conflicts
about durable commitments require resolution within the maintainer's direction;
neither a documentation edit nor an agent-written status label authorizes a
change outside the task. Raise unresolved substantive conflicts and continue
unaffected work. ADR creation is not a routine approval stage.

Mechanical rules belong in `mise run check` or a narrower repository check.
Judgment-based rules are recorded in the pull-request governance review.
Exceptions and deferred correctness work require a linked issue; no separate
waiver process is required at the current project scale.
