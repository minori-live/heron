# Architecture decision records

ADRs record durable choices, their rationale, and the alternatives not selected.
Current architecture details, product behavior, implementation progress and test
evidence belong in their owning documents rather than being copied into each ADR.

## Current records

| Record                                                                                            | Status                            | Scope                                                                                        |
| ------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| [0001 — Runtime ownership and transactions](0001-runtime-ownership-and-transactions.md)           | Accepted                          | Embedded audio, graph/plug-in lifetime, failure containment, receipts, device recovery       |
| [0002 — Project persistence and media](0002-project-persistence-and-media.md)                     | Accepted                          | PGlite worker, build templates, canonical assets, independent audition                       |
| [0003 — MIDI control and observation](0003-midi-control-and-observation.md)                       | Accepted                          | Studio addressing, event delivery, overlays, active-note snapshots                           |
| [0004 — Layered Live documents](0004-layered-live-documents.md)                                   | Accepted design; delivery pending | Shared Mixer, separate documents, Project/Set/Patch, activation, bindings and performance UI |
| [0005 — UI boundary and application preferences](0005-ui-boundary-and-application-preferences.md) | Accepted                          | Storybook interaction ownership, UnoCSS, versioned tutorials, validation boundaries          |
| [0006 — Tagged release updates](0006-tagged-release-updates.md)                                   | Accepted                          | Release eligibility, channels, explicit installation and shutdown safety                     |
| [0007 — Linux editor compatibility](0007-linux-editor-compatibility.md)                           | Proposed                          | X11/XWayland, potential native Wayland hosting, generic fallback                             |

Accepted means the architecture is chosen, not that every feature or release
acceptance test is complete. Each record states its implementation scope; the
[roadmap](../roadmap.md) owns delivery and evidence status. A proposal cannot be
used as permission to implement or claim an accepted compatibility commitment.

## 2026-09-06 baseline reset

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

## When a decision record is required

Create an ADR before changing process/thread ownership, persistence or project
compatibility, cross-process/native protocols, real-time safety, foundational
dependencies, long-term compatibility commitments, or material interaction
semantics departing from the Logic reference or accepted architecture.

Small implementation choices, routine dependency patches, reversible refactors
within one owner, test deduplication and issue triage do not need separate ADRs.
Prefer one cohesive decision over a record for each implementation step.

## Lifecycle and review

Use four digits and a short kebab-case title, starting the next record at **0008**.
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
