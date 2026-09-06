# ADR-0005: Own interactions in Storybook and preferences in main

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Scope: current Vue interaction, styling, and tutorial persistence contracts
- Related: [Design system](../design-system.md), [Interaction design](../interaction-design.md), [Engineering standards](../engineering-standards.md)

## Context

Desktop-local controls, gesture handlers and visual integrations diverged in
focus, keyboard, cancellation and accessibility behavior. Duplicated layout CSS
also made semantic styling drift. Global tutorial preferences need the existing
settings owner rather than a second renderer persistence mechanism.

## Decision

### Interaction ownership

Every visible interaction belongs to a public `@heron/ui` Vue component runnable
in Storybook. The component catalog maps every public Vue export to exactly one
story file with required states; interactive entries have `play` tests.

Desktop maps contracts/stores into UI-only view models and translates normalized
intents into actions. It does not create native controls, handle DOM gestures,
capture pointers, access `DataTransfer`, import Reka UI/ECharts/driver.js directly,
or define local hover/focus/active/drag state styling. Shared UI has no Pinia,
Router, Electron, `window.heron`, IPC or application-contract dependency. Emits
carry normalized points, modifiers, gesture phases, drag values, keyboard commands
and viewport state, not browser or third-party objects. Public wrappers are
domain-specific; generic gesture machinery remains internal.

Named Desktop controllers retain application commands, shortcut capture and
lifecycle listeners. Passive canvas rendering and tick/dB/MIDI-key/snap conversions
remain Desktop responsibilities. Logic is the default interaction reference.
`lint:ui-boundary` enforces zero violations without a permanent exception baseline.

### Styling

Use one root UnoCSS configuration with `presetMini` and no preflight. Utilities
map to semantic CSS custom properties in `packages/ui/src/styles`; Desktop,
Splash and Storybook share generated styles and scanned sources. Utilities own
ordinary layout, spacing, sizing and typography. Interaction states remain with
their UI owner. Scoped CSS owns DAW geometry, pseudo-elements, masks, gradients,
complex selectors and runtime values through local CSS variables.

Utility strings must be complete and static. Do not interpolate names, use raw
utility colors or numeric z-indexes, or create a second token system. Classes
are implementation details, not a public compatibility API.

### Application preferences and tutorials

Main validates and atomically persists typed tutorial preferences through the
revisioned application-settings resource, using its normal idempotency and
reconciliation rules. There is no renderer-local-storage or project-owned progress.
Tutorial IDs are a closed shared union; completion records non-negative versions,
not a boolean. Missing preferences default to automatic Studio Basics onboarding.

Driver.js is a renderer-only visual dependency inside the shared UI adapter.
Desktop controls tutorial state through view models/intents; the adapter owns
transient highlighting/popovers and browser cleanup, never persistence, native
access or audio control. Dismissal suppresses automatic start only for that
renderer session; final completion commits the version. Help replay may ignore
automatic-start and completion state but cannot mutate the project or transport.
Route/application teardown cleans transient visual state.

## Alternatives rejected

- Baselining violations normalizes local reinvention; a generic public gesture
  escape hatch leaves semantics fragmented.
- Desktop wrappers around visual libraries leak browser lifetimes into product flow.
- Scoped CSS alone repeats layout; a full independent utility theme bypasses tokens;
  converting all geometry to utilities makes specialized controls harder to maintain.
- Local storage creates another settings owner; project tutorial progress dirties
  portable content; a completion boolean cannot represent revised tutorials.

## Consequences

New public UI components include catalog/stories in the same change. DOM behavior
can be tested without application stores or IPC. Keep risk-distinct integration
tests, consolidate repeated gestures and pure implementation-text/color assertions,
and preserve measured coverage when reducing tests. CI and local validation use
the complete lint, UI-boundary, source-size and script checks. Package versions
and detailed test matrices remain in manifests and engineering documentation.

## Verification

Check public export/catalog/story completeness, rejected native controls and DOM
objects in Desktop, normalized UI composition, tokens and static extraction,
tutorial default/version/save/replay/teardown, and serialized settings contracts.
Use UI tests, Storybook browser/build checks, representative Electron flows, and
production renderer builds. Review dark/light, narrow layouts and 200% text zoom.

## Reconsider when

Storybook ceases to be the component review runtime, normalized intents cannot
support a renderer platform, shared UI must ship independently compiled styles,
or tutorials require account synchronization or different persistence ownership.
