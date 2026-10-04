# Architecture decision records

ADRs record durable choices, their rationale, and the alternatives not selected.
Current architecture details, product behavior, implementation progress and test
evidence belong in their owning documents rather than being copied into each ADR.

## Current records

| Record                                                                                                 | Status                             | Scope                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [0001 — Runtime ownership and transactions](0001-runtime-ownership-and-transactions.md)                | Accepted                           | Embedded audio, graph/plug-in lifetime, failure containment, receipts, device recovery                      |
| [0002 — Project persistence and media](0002-project-persistence-and-media.md)                          | Accepted                           | PGlite worker, build templates, canonical assets, independent audition                                      |
| [0003 — MIDI control and observation](0003-midi-control-and-observation.md)                            | Accepted                           | Studio addressing, event delivery, overlays, active-note snapshots                                          |
| [0004 — Layered Live documents](0004-layered-live-documents.md)                                        | Accepted design; delivery pending  | Shared Mixer, separate documents, Project/Set/Patch, activation, bindings and performance UI                |
| [0005 — UI boundary and application preferences](0005-ui-boundary-and-application-preferences.md)      | Accepted                           | Storybook interaction ownership, UnoCSS, versioned tutorials, validation boundaries                         |
| [0006 — Tagged release updates](0006-tagged-release-updates.md)                                        | Accepted                           | Release eligibility, channels, explicit installation and shutdown safety                                    |
| [0007 — Linux editor compatibility](0007-linux-editor-compatibility.md)                                | Proposed                           | X11/XWayland, potential native Wayland hosting, generic fallback                                            |
| [0008 — Root Live bootstrap and Capture](0008-root-live-bootstrap-and-capture.md)                      | Accepted; runtime delivery pending | Independent Live documents, mode exit, instance generations and selective Capture                           |
| [0009 — PGlite binary transfer and bounded project reads](0009-pglite-data-transfer-and-read-reuse.md) | Accepted                           | Binary media transfer, cache commit boundaries, bounded MIDI and asset metadata queries                     |
| [0010 — Dependency toolchain compatibility](0010-dependency-toolchain-compatibility.md)                | Accepted                           | Native TypeScript with compiler API compatibility, scoped Storybook runner, coupled dependency APIs         |
| [0011 — Protocol owns the wire shape](0011-protocol-owns-the-wire-shape.md)                            | Accepted                           | Wire, resolved and real-time layers; one model per concept; generated TypeScript declarations               |
| [0012 — Homebrew distribution](0012-homebrew-distribution.md)                                          | Accepted                           | Published-release authority, scoped Tap automation and utility validation                                   |
| [0013 — Live layer editing](0013-live-layer-editing.md)                                                | Accepted                           | Sparse Set/Patch overrides, editing scope, revisioned hierarchy persistence and version-1 upgrade           |
| [0014 — Live runtime activation](0014-live-runtime-activation.md)                                      | Accepted                           | Embedded Live activation, bounded cut, volatile performance and layered Capture                             |
| [0015 — Live layer plug-in state](0015-live-layer-plugin-state.md)                                     | Accepted                           | Binary layer state, independent parameter precedence and explicit complete-state Capture destinations       |
| [0016 — Plugin Analysis measurement sessions](0016-plugin-analysis.md)                                 | Accepted                           | Independent experiment chain, floating point excitation, measurement worker and revisioned reports          |
| [0017 — Plugin Analysis comparison](0017-plugin-analysis-comparison.md)                                | Accepted                           | Atomic two-chain reports, sample-domain difference, independent order FIRs and bounded measurement controls |
| [0018 — Independent plug-in editor windows](0018-independent-plugin-editor-windows.md)                 | Accepted                           | Top-level plug-in windows with per-instance focus and cleanup                                               |
| [0019 — Plugin Analysis waveform sample coordinates](0019-plugin-analysis-waveform-sampling.md)        | Accepted                           | Explicit sample spacing for time and latency-aligned plots                                                  |
| [0020 — Plugin Analysis axis scales](0020-plugin-analysis-axis-scales.md)                              | Accepted                           | Explicit units, minimum grid steps and bounded display zoom                                                 |

Accepted means the architecture is chosen, not that every feature or release
acceptance test is complete. Each record states its implementation scope; the
[roadmap](../roadmap.md) owns delivery and evidence status. A proposal cannot be
used as permission to implement or claim an accepted compatibility commitment.

## 2026-09-06 baseline reset

The numbers in this section's mapping table belong to a **superseded series**.
Current records are 0001–0020; 0009 in the table below refers to the retired
record, not to any record in this series.

At the maintainer's request, the previous 16 records were consolidated into this
seven-record baseline. Numbers restart at 0001. **Old numbers in earlier commits,
issues or discussions refer to the pre-reset series**; use the mapping below.
Repository links now address this baseline. Previously committed records remain
in Git history; the uncommitted transaction audit is incorporated into this
baseline. No duplicate archive, redirect ADRs, or superseded bodies remain here.

This editorial reset preserves accepted product and ownership decisions. It
incorporates the transaction audit, removes obsolete implementation narratives,
corrects roadmap phase references, and retains Linux native-editor work as a
proposal. It does not accept that proposal or mark Live documents delivered.

| Pre-reset record                                   | Current owner                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| 0001 — Embedded audio runtime                      | 0001                                                             |
| 0002 — Live MIDI control addressing                | 0003 for Studio; 0004 for Live bindings                          |
| 0003 — Device recovery precedence                  | 0001                                                             |
| 0004 — Project media assets                        | 0002; panel details remain in interaction design                 |
| 0005 — Host-owned channel adapters                 | 0001                                                             |
| 0006 — Linux editor compatibility (Proposed)       | 0007 (still Proposed)                                            |
| 0007 — Project database template                   | 0002                                                             |
| 0008 — Active MIDI notes                           | 0003                                                             |
| 0009 — Event-driven MIDI control                   | 0003                                                             |
| 0010 — Versioned tutorial preferences              | 0005, with the later UI adapter boundary                         |
| 0011 — In-process plug-in containment              | 0001                                                             |
| 0012 — Separate layered Live documents             | 0004; updated to the Current roadmap phase                       |
| 0013 — Constrained UnoCSS                          | 0005                                                             |
| 0014 — Storybook interaction boundary              | 0005                                                             |
| 0015 — Tagged updates                              | 0006; dependency versions remain in manifests/locks              |
| 0016 — Project and graph transaction consolidation | 0001 transactions; 0002 persistence; 0004 Mixer; 0005 validation |

## 2026-09-30 review

The refactor in pull request #176 was checked against every record. The set was
reviewed for consolidation and kept as it stands, with one addition:

- 0004 and 0008 decide different things — the eventual Project/Set/Patch
  hierarchy, and the root-only bootstrap subset with its Perform and Capture
  semantics. They are sequential stages of one milestone, not competing accounts
  of it, and merging them would produce a record doing two jobs.
- The thirteen type pairs the refactor merged, and the `audio-plugin` identity
  set it deleted, were duplication rather than recorded decisions: no record
  argued for them, and `architecture.md` named the protocol crate as the owner
  already.
- Everything else the records decide — runtimes, receipts, persistence, MIDI,
  updates, editor compatibility — was unaffected. The branch is behaviour
  preserving for all of it.

The new record from that review is 0011, Protocol owns the wire shape. Records
0001–0010 keep their identities and existing links. Homebrew distribution is
recorded separately in 0012.

## When a decision record is required

Create an ADR before changing process/thread ownership, persistence or project
compatibility, cross-process/native protocols, real-time safety, foundational
dependencies, long-term compatibility commitments, or material interaction
semantics departing from the Logic reference or accepted architecture.

Small implementation choices, routine dependency patches, reversible refactors
within one owner, test deduplication and issue triage do not need separate ADRs.
Prefer one cohesive decision over a record for each implementation step.

## Lifecycle and review

Use four digits and a short kebab-case title, starting the next record at **0021**.
Copy [the template](template.md). Status is Proposed, Accepted, Superseded by
ADR-NNNN, or Rejected. Accepted records change only for editorial corrections,
links and explicit implementation-scope clarification; changing a decision
requires a new record and a supersession link.

The authorized baseline reset above is a one-time consolidation, not a routine
renumbering policy. Future history stays stable unless another reset is explicitly
requested. Record owner, context, testable decision, rejected alternatives,
consequences, verification requirements and reconsideration triggers. Link an
issue/PR when available. Normal repository review is sufficient; do not add a
separate approval bureaucracy.
