# ADR-0036: Selective Vue Vapor rendering

- Status: Accepted
- Date: 2026-10-12
- Owners: project maintainers
- Scope: Desktop renderer and shared UI compilation, dependency versions and validation

## Context

Heron's renderer uses Composition API single-file components, but its UI also
depends on Reka's VNode inspection, slot cloning and component refs. Vue Vapor
can compile most of the application's components directly to DOM operations;
converting the Reka composition boundaries breaks those assumptions. Vue Test
Utils also expects VDOM component instances and cannot establish shipped Vapor
behavior through the existing component unit suite.

## Decision

Pin Vue's runtime and SFC compiler to the same exact `3.6.0-rc.11` version.
Desktop keeps `createApp` and installs `vaporInteropPlugin` so Vapor components
and the remaining VDOM components can render each other. Third-party render
components continue to use their published VDOM implementations.

Compile eligible repository-owned SFCs in Vapor mode by default. Keep explicit
VDOM exceptions at Reka composition boundaries that inspect or clone slot
VNodes, forward component refs, or provide `as-child` trigger content. The shared
build policy owns these exceptions and their reasons; renderer and Storybook
use that same policy. A component's use of RouterView, reactive state, Pinia,
translation or a third-party child alone does not require a VDOM exception.

Components exposing imperative APIs use `defineExpose` with a specific public
contract. Resources created by composables belong to their effect scope.
`useLocaleFonts` explicitly disposes its Unhead entry when that scope stops,
because Unhead's current component-instance cleanup does not run in Vapor.

Keep component unit tests on the VDOM compiler to retain their existing
Vue Test Utils behavior assertions. Browser interactions in Storybook and the
desktop application establish compatibility with the actual selective Vapor
build. Do not interpret a passing VDOM unit suite or successful compilation as
evidence that Vapor focus, slot composition or pointer gestures work.

## Alternatives rejected

- Converting every component to Vapor breaks the current Reka slot and ref
  contracts. Replacing Reka would turn this adoption into an interaction-system
  rewrite.
- Retaining all shared UI in VDOM excludes components that work in Vapor and
  leaves avoidable renderer work.
- Patching Vue's global instance getters or third-party package internals hides
  the compatibility boundary and ties application behavior to private APIs.
- Rewriting the unit suite around Vapor internals replaces existing behavioral
  evidence with a dependency migration larger than the rendering change.

## Consequences

Heron adopts a prerelease foundational dependency and retains both rendering
runtimes. The initial benefit is broader direct DOM compilation, not a promised
bundle-size or latency improvement. Dependency upgrades must preserve matching
compiler/runtime versions and validate both sides of the interop boundary.

An exception belongs to a concrete slot, ref or interaction constraint. New
components use the default policy; add an exception only with evidence of the
incompatible boundary. Keep application IPC, persistence and audio runtime
ownership under their existing decisions.

## Verification

Run TypeScript checks, existing VDOM unit behavior tests, and renderer and
Storybook builds. Exercise Heron's menu selection, dialog workflows, numeric
gestures and route navigation through the resulting browser builds. A focused
locale-font regression proves document-language cleanup when the owning effect
scope stops without a VDOM component instance.

## Reconsider when

Vue 3.6 becomes stable, Reka supports the required Vapor slot and ref contracts,
or Vue Test Utils supports Vapor component behavior. Remove individual VDOM
exceptions when Heron's browser interaction evidence passes under Vapor.
Reconsider adoption if shipped interaction regressions cannot be isolated at
these boundaries or measured renderer costs outweigh the benefits.
