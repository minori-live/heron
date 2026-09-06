# Testing policy audit — 2026-09-06

This review applies [Testing policy](testing.md), adapted from TypeApe, to the
working tree after the architecture cleanup and ADR consolidation. The baseline
is that working tree, not Git HEAD: earlier architecture changes and their test
deletions are not counted again here.

## Scope and method

Inventoried test sources across Desktop, shared packages, scripts, Storybook and
Rust. Inspected likely ownership violations in serialization, static source
assertions, UI adapters, rendered styles and repeated gestures. Reviewed retained
transaction, wire, authority, plug-in lifecycle and real-time evidence against
their distinct boundary risks. This is a risk-directed audit, not a claim that
every assertion in every test received an individual review.

## Findings and actions

| Finding                                                                                                    | Action                                                                                                             | Evidence retained or improved                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/serialization.test.ts` and `resource-routing.test.ts` round-tripped hand-written JSON literals. | Removed both files.                                                                                                | Actual RPC validators, native adapters and cross-language MessagePack fixtures exercise Heron's contract.                                            |
| RPC tests froze JSON property order and asserted a hand-written request instead of a producer.             | Removed the literal request test; assert actual `rpcSuccess`/`rpcFailure` results and rejection of numeric epochs. | Public result shape and lossless resource authority remain checked.                                                                                  |
| Main/IPC tests froze file inventory, historical symbol absence and wrapper registration spelling.          | Removed eight assertions-as-test-cases, including the fixed native fixture-name inventory.                         | Raw IPC ownership gates, executable RPC handlers, mutation draining and normative fixture decoding remain.                                           |
| UI tests repeated Vue slot forwarding, Reka direction propagation and tooltip timing.                      | Removed upstream behavior cases and redundant rendering cases.                                                     | Heron's tooltip content, disabled state, dialog actions and busy policy remain.                                                                      |
| UI and Desktop tests inspected SVG paths, asset encoding, private class lists and generated ID suffixes.   | Assert accessible labels, semantic state, actual ID associations and normalized intents instead.                   | Domain zoom conversion, settings navigation and field accessibility remain.                                                                          |
| Three zoom icon variants repeated the same complete gesture, and Toolbar had an extra slot-inventory test. | Keep one full gesture test; smoke the other two public appearances and bare/composed Toolbar contracts.            | Accessible names, controlled values and composed commands preserve coverage without repeating gestures or freezing markup.                           |
| Browser tests froze gradients, menu RGB values and Chromium scrollbar implementation.                      | Removed incidental assertions and one pure hover-color case.                                                       | Search results, commands, local scrolling, focus, hit testing and reflow remain.                                                                     |
| Three Rust protocol tests only asserted same-type encode/decode equality.                                  | Added independent assertions on decoded MessagePack field names, tags, locale, resource metadata and sample rates. | Existing decoding coverage remains; matching encoder/decoder mistakes can no longer conceal the specified wire errors.                               |
| `UiField` captured IDs only at setup, so later validation feedback was not associated with the input.      | Derive IDs reactively and replace a duplicate layout smoke with a state-transition regression.                     | Regression fails before the fix and passes after it; adding/removing help/error text and changing the public control ID preserve valid associations. |

## Evidence that should remain

- PGlite command/snapshot atomicity, rollback, durable graph/media state and
  project isolation test Heron's use of storage, not SQL-engine conformance.
- Worker/main/renderer acknowledgement, idempotency, terminal retention and
  quarantine/recovery test distinct failure boundaries. A store unit test cannot
  replace those integration risks.
- Rust-produced and TypeScript-produced normative bytes test Heron's ABI.
  Fixture decoding remains data-driven without freezing the fixture inventory.
- Plug-in activation, routing, leases, cleanup and audio output test host policy.
  Allocation, bounded queues and concurrency evidence protect real-time behavior.
- Browser bounds, pointer hit testing, focus restoration, text zoom and local
  overflow require rendered integration. Keep the explicit design equivalence
  requirements in [Design system audit](design-system-audit.md); CSS used as a
  selector or a specified geometry check is not automatically an ownership violation.
- Static IPC/import gates, localized catalog completeness, packaged resources,
  release task behavior and security redaction enforce project requirements.

## Coverage and validation

Compare each package with unchanged instrumentation and exclusions. No thresholds
were reduced and no source files were excluded to improve the reported figures.
Percentages below use statement / branch / function / line order.

| Package          | Baseline                      | After policy cleanup          |
| ---------------- | ----------------------------- | ----------------------------- |
| Desktop          | 82.67 / 72.12 / 82.96 / 85.86 | 82.67 / 72.12 / 82.96 / 85.86 |
| Project database | 79.62 / 70.07 / 84.26 / 80.92 | 79.62 / 70.07 / 84.26 / 80.92 |
| UI               | 93.29 / 86.05 / 92.81 / 95.64 | 93.31 / 86.05 / 92.85 / 95.65 |
| Contracts        | 89.90 / 81.05 / 93.02 / 92.81 | 89.90 / 81.05 / 93.02 / 92.81 |
| Project model    | 89.82 / 85.87 / 91.66 / 89.06 | 89.82 / 85.87 / 91.66 / 89.06 |

Native coverage uses the same `heron-audio-host` and `heron-dsp-runtime` library
targets as the architecture audit. Line/function coverage remains respectively
44.37%/44.26% and 91.62%/93.03%.

The maintainer clarified that minimal contract smoke tests should preserve coverage
while duplicated deep tests are removed. Toolbar's existing smoke now covers bare
and composed commands. Zoom keeps its full gesture test once and uses two short
appearance smokes for accessible controls and supplied value updates. Toolbar
retains 4 of 4 branch hits and ZoomControl retains 23 of 24; the initially lost nine
hits are restored in their own components. UiField keeps 14 of 16 branch hits while
gaining the missing state-transition evidence. No other UI file loses line, branch
or function coverage. The no-decrease constraint is satisfied.

The final JS package suite has 1,764 passing tests versus the 1,786-test baseline:
Desktop 1,434, project database 48, UI 163, contracts 71 and project model 48.
There are 22 fewer JS tests and one fewer Playwright case. The count reduction is
not itself the quality criterion; the retained assertions and risk boundaries are.

Validation completed: package coverage suites, 140 native library tests,
72 Storybook tests, 23 Playwright cases, 25 script tests, UI/Desktop/config type
checks, full lint and formatting. PGlite retains its five existing skipped cases.
After the smoke refinement, the UI coverage suite, UI type check, Oxlint and
format checks were rerun; application/native code and other suites were unchanged.
This test/documentation audit does not add new hardware or platform-soak evidence.

Raw coverage, regression-failure and execution logs are local ignored artifacts
under `coverage/architecture-audit/testing-policy-*`. They are not a new CI gate
or a committed maintenance framework.

## PR review follow-up

PR #142 review found that a known failed native activation could retain a candidate
and block later edits. The shared transaction client now aborts that candidate,
logs typed or thrown cleanup failures without masking the activation error, and
leaves unknown outcomes for reconciliation. Five added regression cases cover
these distinct outcomes and subsequent publication through the service boundary.
The packaging task check now verifies flags within the same invocation without
requiring a particular flag order.

The Desktop suite passes 1,439 tests; coverage increases to
82.72 / 72.20 / 82.97 / 85.91 (statement / branch / function / line).
Other package suites are unchanged, giving 1,769 passing JS package tests overall.
