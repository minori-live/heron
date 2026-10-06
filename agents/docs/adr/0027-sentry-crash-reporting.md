# ADR-0027: Consent-gated Electron and embedded native crash reporting

- Status: Proposed
- Date: 2026-10-06
- Owners: project maintainers
- Scope: current crash reporting implementation; acceptance through PR review
- Related: [ADR-0026](0026-welcome-setup-and-diagnostics-consent.md), [ADR-0001](0001-runtime-ownership-and-transactions.md)

## Context

Electron main loads the Rust N-API addon in-process. A native fault can terminate
the entire process before JavaScript can report it. Existing explicit diagnostics
consent defaults to disabled and must govern uploads, including reports surviving
a crash or a later revocation.

## Decision

Electron main owns `@sentry/electron` and initializes its SentryMinidump integration
before dynamically importing application modules that load the addon. Electron's
Crashpad captures main, renderer and Chromium child-process native crashes. The
SDK uploads native minidumps on a subsequent launch or a child crash notification.
Main-process uncaught exceptions and unhandled rejections are captured separately.
Caught Rust panics and typed operation failures are not automatically crash events.
External plug-in probe executables are outside this crash handler's coverage.

No reporting SDK is added to Rust, preload, or renderer. No application helper,
shared memory, renderer telemetry IPC, protocol handlers, preload injection,
performance instrumentation, or audio callback work is added. SDK IPC is disabled
with its zero bitmask and an empty session list. The main diagnostics domain has
no dependencies on application domains.

Initialization reads committed settings synchronously before addon evaluation.
Missing, unreadable and malformed preferences fail closed. Only packaged runs
with explicit consent initialize the SDK; development and automated application
tests never upload. SDK or local cache preparation failure disables reporting
without preventing application startup.

Enabling takes effect on the next launch. Revoking consent stops new uploads at
the settings file's atomic rename commit point, including events waiting for app
readiness. Already dispatched HTTP requests may finish. Revocation is latched for
the remainder of the run. The SDK's client is disabled without flushing queued
events, and the transport has no disk-backed offline retry queue.

The settings file gains a private `diagnosticsConsentEpoch` UUID, rotated on every
consent change and written in the same atomic rename as the public preferences.
It is not part of the renderer contract. Legacy consent uses a fixed `legacy`
epoch until changed. Crashpad writes under `userData/crash-reports/<epoch>`. Startup
deletes other epochs and clears SDK context when entering a new epoch, so enabling
cannot submit dumps captured after revocation by the still-running Crashpad handler.
Startup with consent disabled deletes the reporting caches. Cleanup failure keeps
reporting disabled for that run; it is retried on the next launch. The settings
observer runs after rename even if the later directory sync fails; reconciliation
therefore reflects the actual commit and revocation has already taken effect.

Use a minimal integration list. Do not collect breadcrumbs, HTTP metadata, user
information, local variables, screenshots, sessions, logs, metrics, or traces.
Strip user, request, extra and breadcrumb data before sending error events. Native
minidumps still contain crash memory and can contain paths; the consent copy states
this limitation. Project files and recordings are never added as attachments.

Release Rust builds retain full debug information. JavaScript main bundles receive
debug IDs during build. Tagged-release CI stages matching dSYM/PDB/ELF files for
both macOS architectures and other platforms alongside main source maps, retains
them as a 90-day CI artifact, and uploads using the build-only Sentry token.

## Alternatives rejected

### Separate Rust/native reporting SDK

Installing another signal/panic handler in the embedded addon risks conflict with
Crashpad and reporting work on real-time threads. Electron already owns native
process crash capture.

### Apply opt-in immediately in an existing process

Crashpad remains alive after revocation. Restart and epoch separation provide a
clear boundary between consent periods without uploading unconsented cached dumps.

## Consequences

Crash reporting can diagnose both Electron and embedded-addon process failures.
Users must restart after opting in. Native reports may require a later launch and
network connection; failed uploads are not persisted for retry. Source mapping and
native symbolication require external Sentry upload credentials. Crashes before
reporting initialization cannot be captured. This change does not collect the
performance data contemplated by the older consent record.

## Verification

Consent policy tests cover defaults, malformed authority, development/test exclusion,
epoch cleanup, pending-upload revocation, metadata filtering and startup failure.
Settings tests prove commit notification, failed-save isolation and epoch rotation.
The local Electron crash smoke uses the real SDK with a localhost ingest endpoint
to verify native dump delivery after restart without sending production events.
Desktop unit, type, lint, architecture and production bundle checks verify integration.

## Reconsider when

Renderer JavaScript error reporting, performance telemetry, caught Rust panic
reporting, probe crashes, offline delivery, or immediate opt-in become requirements.
