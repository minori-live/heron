# Testing policy

Status: Accepted\
Owner: project maintainers\
Last reviewed: 2026-09-06

Adapted from TypeApe's `agents/docs/testing.md`, reviewed 2026-08-24, at
`a214188b22c3062b8fdb52a24f8297f6c4039b20`. This adopts its ownership and
narrowest-boundary rules; Rails/RSpec/FactoryBot-specific instructions do not
apply to Heron's TypeScript, Vue, Rust and PGlite stack.

Tests are executable evidence for behavior Heron owns. They are not a second
conformance suite for dependencies, frameworks, browsers, runtimes, plug-in SDKs,
operating systems or remote services. This policy refines the quality floor in
[Engineering standards](engineering-standards.md).

## Ownership rule

A test MUST identify a Heron requirement or regression risk beyond an upstream
dependency working as documented. Owned behavior includes:

- domain calculations, invariants, state transitions and persistence semantics;
- security, resource authority, project isolation and process/thread boundaries;
- outbound requests, wire schemas, inbound normalization and error policy;
- retry, cancellation, fallback, compatibility, recovery and commit semantics;
- public component behavior, user-visible states and normalized product intents;
- plug-in host lifecycle, audio output, scheduling and real-time resource bounds;
- build/release artifacts whose content and shape Heron controls.

Tests MUST NOT freeze upstream internals, SVG paths, markup, error wording,
framework reactivity or slot mechanics, browser defaults, or SDK/parser conformance.
An integration contract is ours on our side: prove Heron's mapping, normalized
result or failure policy, not an unrelated dependency's implementation.

## Decision procedure

Before adding or retaining a test, answer:

1. Which exact Heron requirement or regression does it prove?
2. What is the narrowest boundary at which that behavior is observable?
3. Would a conforming dependency change in internals, markup, assets, wording or
   equivalent output break it? If so, narrow or remove it.
4. Is that requirement proved elsewhere? Retain a broader test only for a distinct
   Heron-owned boundary risk.
5. Do assertions inspect public output or policy, rather than only execution or
   a mock being called?
6. If coverage is the motivation, is this a minimal public-contract smoke for
   an otherwise-unexercised thin path, under the limits below?

A test with no owned answer to question 1 MUST be removed. Deleting upstream or
duplicate evidence does not inherently require a replacement. Test names and
review evidence should make the owned behavior clear without mandatory annotations
or a separate test registry.

## Boundary guidance

### Domain and adapters

Use deterministic inputs and outputs for calculations, parsers Heron implements,
validation and state machines. Boundary/invalid cases need distinct risks, not
combinatorial enumeration for its own sake. Adapters normally use controlled fakes
at the dependency boundary and assert actual request contents, normalization or
policy. Do not instantiate an unrelated parser, client or SDK merely to test its
documented behavior. Dependency upgrades get regressions for Heron's broken usage.

### Vue and shared UI

Use public props, user actions, normalized events and Heron states. Do not test
Vue slot forwarding, framework reactivity, native keyboard/focus behavior or Reka
accessibility defaults unless Heron adds a distinct rule. Heron-specific numeric
gestures, cancellation, disabled/busy policy, and focus restoration across owned
workflows remain valuable.

Exact classes, nesting, snapshots, icon markup and SVG data are not contracts by
default. Only accepted design, accessibility, security or release requirements
justify exact values. Assert semantic state or layout behavior rather than the
particular classes implementing it. Storybook owns component interaction evidence;
Desktop tests own domain mapping and orchestration. A broad test must not repeat
every gesture already tested in the shared component.

### Integration and end-to-end

Use real process, storage or product integration for risks absent at a narrower
boundary: N-API/MessagePack interoperability, preload authority, transactional
PGlite persistence, packaged resources, or critical recording/save/recovery flows.
Assert Heron's bytes, durable state, output or visible result. Plain-object
`JSON.parse(JSON.stringify(fixture))` equality proves JSON, not our encoder.

Real PGlite rollback tests and official VST3/CLAP fixtures remain justified:
they test Heron's transactional usage, native layout negotiation, callbacks,
lease lifetime, state handling and audio output. They do not establish general
PGlite or plug-in conformance. Cross-language normative wire fixtures protect
Heron's schema/ABI and are distinct from a library round-trip test.

Keep allocation, queue pressure, publication, concurrency and signal-correctness
tests at the engine/host boundary. Keep platform hardware and soak evidence where
CI cannot reproduce the device. Neither setup inconvenience nor upstream involvement
makes a data-integrity, security or real-time regression disposable.

### Static content and configuration

Static checks may enforce normative security, import ownership, release metadata,
localization completeness or generated-artifact consistency. Prefer existing lint,
type, schema and build checks when they express the invariant directly. Do not
freeze file inventories, historical symbol absence, prose, line wrapping or
particular registration syntax instead of testing the live contract.

## Fixtures, mocks and coverage

Mocks and fixtures are arrangements, not evidence. Call assertions must identify
an owned request, effect, ordering guarantee or failure policy. Keep fixtures
minimal and explain normative, regression or legacy-comparison intent where it
matters. Behavior-defining values remain explicit; generated/randomized failure
cases must be reproducible and report their seed or equivalent reproduction input.

Coverage is a discovery tool, not evidence of correctness. A metric alone never
justifies a test without a meaningful assertion. One representative smoke is allowed
for an otherwise-unexercised thin path. As clarified by the maintainer on 2026-09-06,
this includes supported public presentation variants and optional composition
entry points when removing duplicated tests would otherwise lose their coverage.
Check the public control's accessible name, supplied value or composed commands;
do not assert SVG paths, internal wrappers or framework implementation details.
Keep full gesture, failure and lifecycle scenarios at the shared behavior boundary,
run once rather than repeated for every appearance. Do not enumerate arbitrary
prop combinations or add unrelated examples to offset a coverage loss.

The maintainer additionally requires coverage not to decrease during the current
cleanup. Compare the same package, metric, instrumentation and exclusions before
and after. Do not lower thresholds, exclude code, or pad the suite to satisfy this
constraint. First reduce redundant cases to the limited contract smoke above, or
add evidence for a real missing owned behavior. If a conflict remains, report the
measured change and resolve that constraint explicitly.

## Representative review decisions

| Candidate                                                              | Decision | Reason                                                          |
| ---------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| JSON round-trip of a hand-written literal                              | Remove   | No Heron serializer, normalizer or authority boundary executes. |
| Reka tooltip implements its timer or Vue forwards a slot               | Remove   | Dependency behavior; test our adapter mapping if needed.        |
| Native graph publication retains a live processor lease on abort       | Keep     | Heron owns lifetime and real-time safety.                       |
| Rust-produced bytes decode to the shared normative TypeScript contract | Keep     | Cross-language ABI interoperability is ours.                    |
| Failed PGlite snapshot decoding rolls back a project command           | Keep     | Atomicity of our transaction is the requirement.                |
| A fixed list of source files or fixture names                          | Remove   | Incidental inventory, not a behavioral contract.                |
| Only authorized modules can call raw Electron IPC                      | Keep     | Explicit project security and ownership constraint.             |
| Exact upstream icon paths or class lists                               | Remove   | Asset/markup implementation is not our requirement.             |
| Saving blocks dismissal until its commit outcome is known              | Keep     | Heron owns the busy and recovery policy.                        |

## Review and maintenance

Review evidence MUST connect tests to requirements/risks and explain intentional
deletions. Remove upstream conformance checks, duplicated narrower behavior,
incidental static assertions, mock-only evidence, unjustified input permutations
and coverage padding. Replace them only when an actual Heron behavior lacks
evidence. Normal repository review is sufficient; do not create another approval
or annotation framework.
