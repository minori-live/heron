# Architecture decision records

Current specifications live in the owning architecture and feature documents.
The records retained here explain durable choices and realistic alternatives.
Read the specification for current behavior and the roadmap for delivery evidence.

## Retained decisions and proposals

| Record                                                                                                 | Status   | Current specification                                           |
| ------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------- |
| [0001 — Embedded runtime and explicit commits](0001-runtime-ownership-and-transactions.md)             | Accepted | [Specification](../architecture.md)                             |
| [0002 — Self-contained projects and canonical media](0002-project-persistence-and-media.md)            | Accepted | [Specification](../project-database.md)                         |
| [0003 — Separate MIDI control from observation](0003-midi-control-and-observation.md)                  | Accepted | [Specification](../midi-control.md)                             |
| [0004 — Standalone layered Live documents on the shared Mixer](0004-layered-live-documents.md)         | Accepted | [Specification](../live-documents.md)                           |
| [0005 — Shared interaction ownership](0005-ui-boundary-and-application-preferences.md)                 | Accepted | [Specification](../design-system.md)                            |
| [0006 — Explicit installation from published releases](0006-tagged-release-updates.md)                 | Accepted | [Specification](../application-updates.md)                      |
| [0007 — Linux native editor compatibility tiers](0007-linux-editor-compatibility.md)                   | Proposed | [Specification](../native-call-boundary.md)                     |
| [0011 — One owner for the native wire shape](0011-protocol-owns-the-wire-shape.md)                     | Accepted | [Specification](../architecture.md#native-wire-model-ownership) |
| [0016 — Independent volatile plug-in measurement sessions](0016-plugin-analysis.md)                    | Accepted | [Specification](../plugin-analysis.md)                          |
| [0027 — Consent-gated crash reporting in Electron main](0027-sentry-crash-reporting.md)                | Proposed | [Specification](../crash-reporting.md)                          |
| [0031 — Consume independently released built-in plug-ins](0031-artifact-delivered-built-in-plugins.md) | Accepted | [Specification](../builtin-plugin-distribution.md)              |

Accepted records preserve earlier choices; they do not certify feature delivery
or validation. The native Wayland and crash-reporting proposals remain Proposed.
Source implementation and a historical status label are separate facts.

## 2026-10-12 consolidation

The maintainer explicitly requested this complete retrospective restructuring
after the governance change. All 35 records were reviewed. Eleven retain their
original identities (nine Accepted, two Proposed); 24 implementation/staging
records are incorporated into owning documents. Numbers are not reused or reset.
No new architecture or acceptance is introduced by this editorial change.

The table below maps every identity in the reviewed series. Original text remains
available at [the pre-consolidation revision](https://github.com/minori-live/heron/tree/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr).
Removed files are not duplicated as an archive or redirect collection. Repository
links now point to current owners; historical external links should use the pinned
revision. The original series has no 0024, which is not a newly available number.

Obsolete root-only/scalar-only Live restrictions, strict single-FIR analysis,
plug-in symbol staging and old toolchain repairs remain history. Their replacements
are stated in the current documents. The roadmap retains outstanding Live scope
and evidence. Producer-owned EQ DSP/editor requirements remain in `heron-plugins`;
Heron's EQ notes own host integration and compatibility.

| Original record                                                                    | Treatment                                              | Current owner                                                                                        | Historical source                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 — Own the embedded runtime and commit state explicitly                        | Retained rationale                                     | [Runtime ownership, commits and containment](../architecture.md)                                     | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0001-runtime-ownership-and-transactions.md)        |
| 0002 — Persist self-contained projects with canonical media                        | Retained rationale                                     | [Persistence, media and templates](../project-database.md)                                           | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0002-project-persistence-and-media.md)             |
| 0003 — Separate MIDI control delivery from state observation                       | Retained rationale                                     | [MIDI control and observation](../midi-control.md)                                                   | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0003-midi-control-and-observation.md)              |
| 0004 — Build standalone layered Live documents on the shared Mixer                 | Retained rationale                                     | [Live documents](../live-documents.md)                                                               | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0004-layered-live-documents.md)                    |
| 0005 — Own interactions in Storybook and preferences in main                       | Retained rationale                                     | [Shared UI; application preferences](../design-system.md)                                            | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0005-ui-boundary-and-application-preferences.md)   |
| 0006 — Update installed tagged releases through Pages metadata and GitHub Releases | Retained rationale                                     | [Application updates](../application-updates.md)                                                     | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0006-tagged-release-updates.md)                    |
| 0007 — Tier Linux native plug-in editor compatibility                              | Retained rationale                                     | [Current Linux support; retained proposal](../native-call-boundary.md)                               | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0007-linux-editor-compatibility.md)                |
| 0008 — Bootstrap root Live performance with frozen selective Capture               | Incorporated into specification                        | [Live Save, Capture and activation](../live-documents.md)                                            | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0008-root-live-bootstrap-and-capture.md)           |
| 0009 — PGlite binary transfer and bounded project reads                            | Incorporated into specification                        | [Binary transfer and cache rules](../project-database.md)                                            | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0009-pglite-data-transfer-and-read-reuse.md)       |
| 0010 — Dependency toolchain compatibility                                          | Incorporated into specification                        | [Current toolchain compatibility](../environment.md#coupled-toolchain-dependencies)                  | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0010-dependency-toolchain-compatibility.md)        |
| 0011 — Let the protocol crate own the wire shape                                   | Retained rationale                                     | [Native wire ownership](../architecture.md#native-wire-model-ownership)                              | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0011-protocol-owns-the-wire-shape.md)              |
| 0012 — Homebrew distribution                                                       | Incorporated into specification                        | [Homebrew publication and recovery](../homebrew-distribution.md)                                     | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0012-homebrew-distribution.md)                     |
| 0013 — Persist sparse Live Set and Patch edits                                     | Incorporated into specification                        | [Live layer editing](../live-documents.md#layers-and-editing)                                        | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0013-live-layer-editing.md)                        |
| 0014 — Connect layered Live performance to the embedded runtime                    | Incorporated into specification                        | [Live activation and recovery](../live-documents.md#perform-and-activation)                          | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0014-live-runtime-activation.md)                   |
| 0015 — Persist and capture complete plug-in state in Live layers                   | Incorporated into specification                        | [Live complete state and Capture](../live-documents.md#save-capture-and-exit)                        | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0015-live-layer-plugin-state.md)                   |
| 0016 — Plugin Analysis measurement sessions                                        | Retained rationale                                     | [Plugin Analysis](../plugin-analysis.md)                                                             | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0016-plugin-analysis.md)                           |
| 0017 — Plugin Analysis comparison and independent order identification             | Incorporated into specification                        | [Comparison and measurement models](../plugin-analysis.md#measurements)                              | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0017-plugin-analysis-comparison.md)                |
| 0018 — Independent plug-in editor windows                                          | Incorporated into specification                        | [Editor window lifetime](../native-call-boundary.md#editor-windows-and-platform-surfaces)            | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0018-independent-plugin-editor-windows.md)         |
| 0019 — Plugin Analysis waveform sample coordinates                                 | Incorporated into specification                        | [Waveform coordinates](../plugin-analysis.md#coordinates-and-presentation)                           | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0019-plugin-analysis-waveform-sampling.md)         |
| 0020 — Plugin Analysis axis units and scale floors                                 | Incorporated into specification                        | [Plot units and limits](../plugin-analysis.md#coordinates-and-presentation)                          | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0020-plugin-analysis-axis-scales.md)               |
| 0021 — Interpret VST3 results by method and effect                                 | Incorporated into specification                        | [VST3 result and recovery contracts](../vst3-hosting.md)                                             | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0021-vst3-result-contracts.md)                     |
| 0022 — Tolerate declined optional VST3 interface queries                           | Incorporated into specification                        | [Optional VST3 interface denials](../vst3-hosting.md#result-interpretation)                          | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0022-vst3-optional-interface-denials.md)           |
| 0023 — Probe the selected plug-in before runtime loading                           | Incorporated into specification                        | [Selected capability probes](../native-call-boundary.md#selected-capability-probes)                  | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0023-plugin-scoped-runtime-probes.md)              |
| 0025 — Plugin Analysis parametric EQ fitting                                       | Incorporated into specification                        | [EQ fitting and export](../heron-eq.md#eq-fit-window-and-computation)                                | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0025-plugin-analysis-eq-fitting.md)                |
| 0026 — Welcome setup and diagnostics consent                                       | Incorporated into specification                        | [Welcome and consent preferences](../application-preferences.md#welcome-setup)                       | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0026-welcome-setup-and-diagnostics-consent.md)     |
| 0027 — Consent-gated Electron and embedded native crash reporting                  | Retained rationale                                     | [Reporting operations; retained proposal](../crash-reporting.md)                                     | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0027-sentry-crash-reporting.md)                    |
| 0028 — Diagnostics consent restart and environment isolation                       | Proposal rationale in 0027; source behavior documented | [Consent migration, restart and isolation](../crash-reporting.md#runtime-authority-and-consent)      | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0028-diagnostics-consent-restart-and-isolation.md) |
| 0029 — Native Heron EQ and fitted-preset interchange                               | Incorporated into specification                        | [EQ integration; producer-owned DSP/editor](../heron-eq.md)                                          | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0029-native-heron-eq.md)                           |
| 0030 — EQ graph and fixed band controls                                            | Incorporated into specification                        | [EQ host gestures; producer-owned UI](../heron-eq.md#producer-compatibility-boundary)                | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0030-eq-graph-and-floating-controls.md)            |
| 0031 — Artifact-delivered built-in plug-ins                                        | Retained rationale                                     | [Producer/consumer release ownership](../builtin-plugin-distribution.md)                             | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0031-artifact-delivered-built-in-plugins.md)       |
| 0032 — Release artifact identity                                                   | Incorporated into specification                        | [Artifact identity and caching](../builtin-plugin-distribution.md#artifact-identity-and-publication) | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0032-release-artifact-identity.md)                 |
| 0033 — Windows native editor presentation surfaces                                 | Incorporated into specification                        | [Windows native presentation](../native-call-boundary.md#editor-windows-and-platform-surfaces)       | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0033-windows-native-editor-surfaces.md)            |
| 0034 — Runtime-only plug-in artifacts                                              | Incorporated into specification                        | [Runtime-only plug-in artifacts](../builtin-plugin-distribution.md#symbols)                          | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0034-runtime-only-plugin-artifacts.md)             |
| 0035 — Explicit mono and stereo output routes                                      | Incorporated into specification                        | [Output route formats](../interaction-design.md#output-route-formats)                                | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0035-explicit-route-formats.md)                    |
| 0036 — Startup progress locale                                                     | Incorporated into specification                        | [Startup locale](../localization.md#startup-progress-language)                                       | [Original](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0036-startup-progress-locale.md)                   |

## Earlier numbering

The 2026-09-06 maintainer-requested reset replaced an older 16-record series with
seven records and restarted numbering. Numbers in discussions before that reset
refer to that retired series. Its complete mapping remains in the
[pinned historical index](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/README.md#2026-09-06-baseline-reset).
The 2026-09-30 review and subsequent additions are also retained there. This
consolidation preserves the later identities instead of starting a third series.

## Documentation defaults

Update the existing owning documents as part of authorized work. Choose the
location by the information's purpose:

| Information                                                         | Default location                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| Current architecture, behavior, and compatibility policy            | Existing architecture, interaction, or feature document |
| A bug's cause, the fix, and validation results                      | Pull request description                                |
| Temporary limitations and tracked follow-up work                    | Issue                                                   |
| A non-obvious local implementation constraint                       | Comment beside the owning code                          |
| A durable choice whose rationale deserves independent future review | ADR, when explicitly requested by a maintainer          |

Do not create a new decision document under another name to bypass these rules.
Update shipped user documentation when user-visible behavior changes, following
its existing scope. Documentation requirements do not imply an ADR requirement.

## Maintainer direction

Maintainers decide when to create an ADR. Agents MUST NOT create one, including
a Proposed draft, without an explicit maintainer request to create that record.
They MUST NOT mark a record Accepted without explicit maintainer acceptance.
Authorization to implement a feature or fix does not imply either action.
A request already given in the task or review is sufficient; do not ask again.

Changes involving process/thread ownership, persistence, cross-process/native
protocols, real-time behavior, foundational dependencies, compatibility, or
interaction semantics do not automatically require an ADR. Neither does the
presence of a related accepted record. Routine fixes, protocol fields, schema
migrations within an existing persistence design, display thresholds, gestures,
dependency updates, and implementation stages belong in their owning documents
and PRs unless a maintainer explicitly requests a decision record.

When a choice appears worth recording separately, briefly explain in the work
summary or PR why future maintainers would need its rationale, which realistic
alternatives carry meaningful tradeoffs, and what would make reversal costly.
A choice of embedded versus separate-process audio runtime or a replacement
project storage model may justify that discussion. These are considerations for
the maintainer, not automatic triggers or a checklist required for every PR.

Continue work already authorized. Do not pause solely to ask whether to create
an ADR, and do not add an ADR approval stage to routine development. Changes
outside the authorized task or to commitments it does not authorize changing
still require maintainer direction, regardless of documentation format.

## Current rules and historical rationale

Current architecture and product rules belong in their owning documents. ADRs
preserve important choices and explain their rationale; they are not a second
copy of the current specification or an implementation log. When an authorized
change affects current rules, update the owning documents in the same change.

An implementation detail does not become a permanent architectural commitment
solely because an accepted ADR mentions it. Correcting a field, threshold,
compatibility edge case, or staged implementation detail does not require a
replacement record. Update the owning document when applicable; if an existing
ADR would mislead readers, add a short dated amendment linking the current
rule and the relevant PR or issue. Preserve the original rationale and identify
what changed rather than silently rewriting the historical choice.

A genuine reversal of a durable decision may warrant a replacement ADR at the
maintainer's direction. Do not silently weaken existing product promises,
ownership boundaries, safety constraints, or compatibility commitments by
editing current documentation or labeling a substantive change a detail. If
such a conflict is outside the authorized scope or cannot be resolved from the
maintainer's direction, raise that specific decision while continuing unaffected
work. A difference in historical implementation detail alone is not a reason
to block work.

## Lifecycle and review

When requested, use a four-digit number above the highest historical number
(0036 in the reviewed series), never fill gaps or reuse retired identities, and
choose a short kebab-case title. Copy [the template](template.md). Status is Proposed, Accepted,
Superseded by ADR-NNNN, or Rejected. Start at Proposed unless the maintainer has
explicitly accepted the decision. Record the request and acceptance references
when available; an agent's status label is not evidence of maintainer acceptance.

Keep each record focused on one durable choice: context, decision, meaningful
alternatives, consequences, and reconsideration conditions. Link current
specifications and relevant validation evidence rather than duplicating field
catalogs, implementation plans, test checklists, or temporary repair details.
When a replacement is requested and accepted, link both records and identify
which decision it supersedes. Normal repository review is sufficient.

The historical resets and the 2026-10-12 consolidation were explicitly requested
by the maintainer. They are not a routine renumbering or cleanup policy. Remaining
record identities and statuses stay stable; further retrospective consolidation
requires a separate maintainer request.
