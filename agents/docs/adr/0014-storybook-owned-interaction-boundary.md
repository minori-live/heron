# ADR-0014: Make Storybook the interaction-component boundary

- Status: Accepted
- Date: 2026-08-19
- Owners: project maintainers
- Related: Storybook-driven UI boundary refactor

## Context

Desktop accumulated native controls, DOM gesture handlers, third-party visual integrations, and
interaction-state CSS next to product orchestration. Similar controls then diverged in keyboard,
focus, cancellation, disabled, and accessibility behavior, while Storybook no longer described the
complete public UI surface.

## Decision

Every visible interaction is owned by a public `@heron/ui` Vue component that runs independently in
Storybook. `apps/design-system/src/component-catalog.ts` maps every public Vue export to exactly one
story file and declares its interaction and required states. Interactive catalog entries have a
`play` test.

Desktop views, hosts, and containers map contract/store data to UI-only view models and translate
typed UI intents back to actions. They do not create native controls, receive DOM gesture objects,
capture pointers, access `DataTransfer`, import Reka UI/ECharts/driver.js directly, or define local
hover/focus/active/drag visual states. `@heron/ui` remains free of Pinia, Router, Electron,
`window.heron`, IPC, and application contracts. Public emits carry normalized points, modifiers,
gesture phases, drag values, keyboard commands, and viewport state rather than DOM or third-party
objects.

Application-wide commands, shortcut capture, and lifecycle listeners remain in the explicitly
named Desktop controllers. Passive canvas rendering and product-domain conversions such as tick,
dB, MIDI-key, and snap calculations also remain in Desktop.

The zero-baseline policy is enforced by `lint:ui-boundary`; no permanent exception list is kept.

## Alternatives rejected

### Baseline existing violations

A decreasing baseline would make local invention remain normal and allow regressions to hide behind
the stored count.

### Export a generic gesture escape hatch

A public generic surface would technically move DOM code while leaving interaction semantics and
visual state fragmented across Desktop. The shared gesture surface therefore remains internal to
`@heron/ui`; public wrappers are domain-specific.

### Let Desktop wrap third-party visual libraries

This would keep browser lifecycle and third-party objects in product components. ECharts and
driver.js instead enter through view-model-driven UI adapters.

## Consequences

Adding a public UI component requires catalog and Storybook work in the same change. Domain
interactions have more explicit view models and intent types, but can now be tested without stores,
IPC, or Electron. Desktop integration tests assert user-visible behavior rather than component
internals. Small visual normalization is expected as duplicated state CSS is removed.

## Verification

`lint:ui-boundary` audits Desktop SFC templates, production TypeScript, scoped CSS, Storybook
templates/MDX, package imports, public exports, catalog entries, story exports, and interactive
`play` coverage. Its fixture tests cover rejected native controls, DOM gestures, direct imports,
missing catalog stories, and accepted UI composition. UI unit tests, Storybook browser tests/build,
Desktop unit tests, Electron representative flows, and `mise run check` remain the release path.

## Reconsider when

Replace this ADR if Storybook is no longer the component review runtime, or if a future renderer
platform cannot express normalized interaction intents without exposing platform event objects.
