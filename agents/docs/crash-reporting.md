# Crash reporting operations

This document owns current reporting operations, consent authority and limits.
The public DSN is in the main diagnostics module. It is not an upload credential.
See [runtime authority and consent](#runtime-authority-and-consent) for the
implementation boundary and historical proposal status.

## Release symbol uploads

Configure the GitHub Actions repository secret `SENTRY_AUTH_TOKEN` with Sentry
release/artifact upload permissions, and repository variables `SENTRY_ORG` and
`SENTRY_PROJECT` for the destination organization/project ID or slug. The token is
only passed to the tagged-release build's symbol-upload step and never packaged.
All three must be supplied together. With none configured, CI logs the missing
configuration and retains `heron-sentry-symbols-<platform>` artifacts for 90 days;
crash events still arrive but Heron frames require uploading the matching symbols.

Tagged builds keep full native debug information, including architecture-specific
macOS dSYMs and Windows PDBs. Packaging smoke builds deliberately strip symbols and
do not upload them. Source maps contain build-injected debug IDs matching shipped
main bundles. `pnpm --filter @heron/desktop upload:sentry-symbols --stage-only` stages
local release symbols without network access. Normal invocation stages and uploads
when all three Sentry environment variables are available.

Uploads cover Heron's application source maps and native addon symbols.
Plug-in Sentry integration is deferred; plug-in symbols are not downloaded or
uploaded. See [plug-in symbol policy](builtin-plugin-distribution.md#symbols).

To upload a retained artifact manually with the locked CLI, extract it and run
`sentry-cli debug-files upload --include-sources --wait <artifact>/native`, followed
by `sentry-cli sourcemaps upload --release heron@<version> --validate <artifact>/main`.
Preserve symbols for supported releases beyond CI retention in your release archive.

## Local validation

`pnpm --filter @heron/desktop test:crash-reporting` runs the real SDK and Electron
against a localhost ingest server in disposable data directories. It deliberately
crashes an isolated Electron test process after loading the native addon, then
relaunches to verify native minidump delivery. It does not use the production DSN.
Linux needs an X server, for example `xvfb-run -a pnpm --filter @heron/desktop test:crash-reporting`.

For production confirmation, install a tagged artifact, explicitly enable crash
reports, restart, reproduce the actual fault and relaunch. Check Sentry's release,
native attachment, architecture and symbolicated Heron frames. Do not deliberately
crash a session containing unsaved creative work.

## Runtime authority and consent

The code paths in `main/diagnostics`, shared consent decoding and application
settings implement the behavior below. The historical reporting records remained
Proposed; documenting source behavior does not retroactively accept them or prove
production upload/symbolication. [ADR-0027](adr/0027-sentry-crash-reporting.md)
retains the proposed architectural rationale. Release evidence is separate.

Main initializes the minimal Electron Sentry/Crashpad integration before dynamic
imports that evaluate the addon. It covers main/Chromium child native crashes and
main uncaught exceptions/unhandled rejections. Native uploads may wait for a later
launch or child notification. Caught Rust panics, typed failures and external
probe crashes are not automatic events. Rust, preload and renderer have no SDK;
SDK IPC is disabled with zero bitmask and empty sessions. There is no renderer
telemetry API, performance instrumentation or callback reporting work.

Reporting requires packaged execution, production build mode, validated release
marker matching the application version and committed explicit consent. Runtime
development/test signals deny reporting even with a real DSN. Unknown authority,
missing/unreadable/malformed settings, cache failure or SDK initialization failure
fail closed without blocking ordinary startup. DSN choice cannot authorize uploads.

Enabling takes effect on next launch. Revocation applies at settings rename,
including uploads waiting for readiness, and stays latched for that run. Already
dispatched HTTP may finish. Disable the client without flushing; no disk-backed
transport retry queue is installed.

A private `diagnosticsConsentEpoch` UUID rotates with consent in the same settings
commit and never enters renderer contracts. Historical explicit consent with an
absent epoch or exact `legacy` marker may use the legacy period until its next
successful save creates a UUID; other malformed epochs fail closed. Valid UUIDs
survive unrelated saves and opted-out saves never grant reporting authority.
Crashpad writes under `userData/crash-reports/<epoch>`; startup removes other
epochs and old SDK context. Disabled startup removes caches. Cleanup failure keeps
reporting disabled until a later successful launch. Thus enabling cannot upload
dumps captured after revocation by a still-running handler.

Nonproduction profiles use separate user/session/crash paths before services load,
and their provenance marker prevents later production reporting even if copied.
There is no general runtime endpoint override; isolated smoke verification uses
inert mocks or a bounded localhost harness outside production routing.

No breadcrumbs, request/user metadata, local variables, screenshots, sessions,
logs, metrics or traces are collected. Before sending errors, remove user/request/
extra/breadcrumb fields. Native minidumps can still contain memory and paths;
consent copy states this limitation. Never attach projects or recordings. Welcome
save/restart and retry behavior lives in [application preferences](application-preferences.md).
