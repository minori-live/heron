# ADR-0013: Use UnoCSS as a constrained layout utility layer

- Status: Accepted
- Date: 2026-08-18
- Owners: project maintainers
- Related: UI and layout source migration

## Context

Heron's renderer and shared UI package contain repeated flex, grid, spacing,
sizing, and typography declarations across scoped component styles. The design
system already owns semantic CSS custom properties, theme switching, density,
and domain-specific rendering rules. A utility engine can remove structural
duplication, but an unconstrained second token system would weaken those
existing guarantees and make the shared UI package render differently across
Desktop and Storybook.

## Decision

Use UnoCSS with `presetMini` and preflight disabled as a build-time layout
utility layer for the Desktop renderer and Storybook. A single root
configuration maps semantic utilities to the CSS custom properties owned by
`packages/ui/src/styles`. Desktop, Splash, and Storybook load the same generated
stylesheet and scan the same renderer, UI, and story sources.

Utilities own ordinary layout, spacing, sizing, typography, and simple visual
states. Scoped CSS continues to own DAW geometry, pseudo-elements, masks,
gradients, complex selectors, and runtime values passed through local CSS
custom properties. Component props, events, slots, accessibility contracts,
and product interaction semantics do not change. Utility class names are
source-level implementation details, not a public compatibility API.

Dynamic utility-name interpolation, raw utility colors, and numeric utility
z-indexes are forbidden. Variant utilities must be present as complete static
strings so production extraction is deterministic.

## Alternatives rejected

### Keep only scoped CSS

This preserves the current build but continues structural duplication and
makes token-aligned layout changes unnecessarily broad.

### Adopt the complete Wind preset and a new theme

This offers a larger vocabulary but makes it easy to bypass Heron's semantic
tokens and density rules.

### Convert every style to utilities

Atomic classes are a poor representation for specialized audio controls,
runtime geometry, and tightly related pseudo-elements.

## Consequences

Desktop and Storybook must keep UnoCSS enabled whenever they consume UI source.
The root configuration and CSS token files together form the styling toolchain.
Simple component style blocks become smaller, while complex controls retain
scoped CSS. Design lint and production builds detect configuration drift and
non-extractable utilities.

## Verification

Run configuration type checking, design lint, UI and Desktop unit tests,
Storybook tests and static build, and the Desktop renderer production build.
Review critical dark and light stories at narrow width and 200% text zoom.

## Reconsider when

Replace this decision if `@heron/ui` becomes a compiled external package that
must ship styling independently, UnoCSS no longer supports the locked Vite
toolchain, or measured maintenance cost exceeds the removed duplication.
