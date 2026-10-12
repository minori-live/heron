# ADR-0005: Shared interaction ownership

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Current specification: [owning document](../design-system.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0005-ui-boundary-and-application-preferences.md)

## Context

Desktop-local controls diverged in focus, keyboard, cancellation and accessibility.
Duplicated styling and browser-library adapters made behavior difficult to review
without running full application state.

## Decision

Visible interactions belong to public `@heron/ui` components reviewable in
Storybook. Desktop composes serializable presentation models and normalized intent;
shared UI owns browser lifetimes and gestures without stores, IPC or persistence.
A common semantic token/UnoCSS vocabulary serves Desktop, Splash and Storybook.
Main retains application preference authority, including tutorial progress; see
[application preferences](../application-preferences.md).

## Alternatives and consequences

A permanent baseline of local exceptions normalizes reinvention. Generic public
gesture escape hatches and Desktop wrappers retain fragmented browser ownership.
A separate utility palette creates a second theme; forcing specialized DAW geometry
into utilities makes it harder to maintain. Renderer-local tutorial storage creates
a second persistence owner, while project-owned progress dirties portable content.

Public components carry their catalog/stories and can be tested independently.
Domain conversion and application orchestration remain outside UI; complete
application journeys still require their own evidence under testing policy.

## Reconsider when

The component review runtime changes, normalized intent cannot support a target
renderer, or preferences need a different durable owner such as account sync.
