# ADR-0010: Persist versioned renderer tutorial preferences

- Status: Accepted
- Date: 2026-08-11
- Owners: project maintainers
- Related: Studio Basics onboarding implementation

## Context

Studio Basics must appear automatically until a user completes it, remain
disabled when the user turns off automatic tutorials, and support an explicit
replay from the Help menu. The result must survive application restarts without
creating a renderer-only persistence owner or bypassing the existing revisioned
settings protocol.

## Decision

Application settings own a typed `TutorialPreferences` value containing the
automatic-start preference and completed tutorial versions. Electron main
validates and atomically persists the value through the existing application
settings resource; the renderer uses the existing revision, idempotency, and
reconciliation path for mutations.

Tutorial identities are a closed shared-contract union. Completion is a
non-negative version so a materially revised tutorial can be offered again.
Settings files without tutorial preferences default to automatic Studio Basics
onboarding for both new and existing users.

Driver.js is renderer-only. It owns transient highlighting and popovers but does
not own persisted state, cross the preload boundary, or interact with the audio
runtime. Closing a tutorial suppresses it only for the current renderer session;
only the final completion action commits its current version.

## Alternatives rejected

### Renderer local storage

Local storage would create a second settings owner, bypass typed recovery and
revision reconciliation, and make the global setting inconsistent with other
device preferences.

### One completion boolean

A boolean cannot distinguish an obsolete walkthrough from the current version
and would require an incompatible migration whenever Studio Basics changes.

### Project-owned progress

The tutorial describes the application workspace, not project content. Storing
progress in a project would repeat onboarding for every project and modify
portable project state for a device-local preference.

## Consequences

- Tutorial preference changes use the same single commit point as other global
  settings.
- Shared contracts and legacy settings recovery must remain compatible when new
  tutorial IDs are introduced.
- Manual replay may ignore automatic-start and completion state, but it cannot
  mutate project data or invoke transport controls.
- Driver.js styling and lifecycle remain isolated to the renderer and must be
  cleaned up on route or application teardown.

## Verification

- Main-process settings tests cover default recovery, validation, persistence,
  and reload.
- Renderer tests cover completion, early dismissal, the global switch, Help
  replay, and route teardown.
- Desktop type checks verify that the new setting and command remain serializable
  across contracts, preload, main, and renderer.

## Reconsider when

Replace this decision if tutorials become account-synchronized, project-specific,
or require interactive actions that cross the native or real-time boundary.
