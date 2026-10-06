# ADR-0028: Diagnostics consent restart and environment isolation

- Status: Proposed
- Date: 2026-10-06
- Owners: project maintainers
- Scope: consent migration, first-run restart, and production reporting authority
- Related: [ADR-0026](0026-welcome-setup-and-diagnostics-consent.md), [ADR-0027](0027-sentry-crash-reporting.md), [ADR-0006](0006-tagged-release-updates.md)
- Supersedes: the legacy epoch persistence and welcome completion behavior in ADR-0026/0027

## Context

Legacy settings can contain explicit diagnostics consent without an epoch. An
unrelated settings save previously persisted the internal `legacy` marker, which
the next reporting startup rejected. First-run opt-in already creates a UUID, but
requires a new process before reporting can start. Exiting setup immediately after
saving offers no reliable way to perform that restart or show a failed attempt.

Packaging alone does not establish production authority: development and automated
tests can launch packaged binaries with copied preferences and a real DSN. Their
reports and cached native dumps must never reach the production service.

## Proposed decision

Electron main retains exclusive ownership of persisted consent and reporting.
Missing consent stays disabled. Valid UUID epochs survive unrelated saves. Only
historical explicit consent with an absent epoch or the exact old `legacy` marker
may migrate; its next successful settings save writes a fresh UUID atomically with
the preferences. Other malformed epochs fail closed. Consent changes rotate the
epoch, and entering a new epoch discards old native dumps and SDK context. An
unrelated save never authorizes opted-out reporting.

When diagnostics is selected in first-run setup, the main action is **Save and
restart**. Otherwise it remains **Continue**. Both commit theme, language, consent,
and welcome completion together through the existing revisioned settings mutation.
Restart is requested only after that durable outcome is known. A save failure keeps
the editable choices. After a successful save, setup stays visible while restart
is pending or blocked; retry and continue-later actions explain that the setting
will apply on the next launch. Persisted completion suppresses setup in a new
process even when the previous restart attempt was cancelled.

The typed restart request uses the existing project-close workflow and main exit
lifecycle. Main gates new mutations, drains admitted work, and rechecks document
and service safety before scheduling Electron relaunch. It excludes the restart
request itself from that drain. Repeated requests cannot schedule multiple launches.
No renderer reload substitutes for a process restart. Failures before teardown
remain retryable. After relaunch is scheduled, ordinary quit waits for its existing
service cleanup and never reopens a partially stopped runtime for another attempt.

Production reporting requires all of a packaged binary, a production build mode,
and the validated release marker matching the application version. Runtime
development and test signals deny reporting even when those prerequisites and
explicit consent are present. Unknown build authority fails closed. DSN selection
cannot override this policy. The gate precedes SDK initialization and native-addon
evaluation, so it governs exception hooks, Crashpad, and queued dump delivery.

Nonproduction startup uses separate user-data, session-data, and crash-dump paths
before loading application services. Profiles marked as nonproduction cannot be
promoted into production reporting. Normal development and tests have no reporting
transport override. Isolated verification may replace the SDK with a mock or a
fixed loopback transport in temporary harness code; no environment variable grants
access to an arbitrary endpoint. Production remains off by default and preserves
the restart, revocation latch, and consent-epoch boundaries from ADR-0027.

## Alternatives rejected

### Initialize immediately after opt-in

The existing process may contain Crashpad state from an earlier consent period.
A complete restart keeps initialization and cache authority at one boundary.

### Use only an environment label or `NODE_ENV`

Neither prevents a packaged test or development process from initializing a real
transport. Release build authority and runtime denials must both be checked.

### Add a runtime endpoint override for tests

An arbitrary override would allow test configuration to target the real service.
Verification instead injects a bounded local transport outside production code.

## Consequences

Ordinary CI packages and unpackaged development builds cannot send diagnostics.
Testing production policy requires explicit isolated simulation with a mock SDK.
Legacy migration may discard old reports when it assigns the first UUID. Settings
remain saved when restart is cancelled; the user can retry or launch later.

## Verification

For this follow-up the maintainer explicitly requested one-time validation instead
of new regression cases. Existing tests are adapted only where the changed contract
requires it. Review evidence records isolated legacy saves, real Electron process
closure and startup, failure/cancellation and repeated actions, runtime/build deny
signals with an inert real-looking DSN, and local-only native dump delivery and
revocation checks. Repository checks and exact-commit CI results are reported in
the pull request; no production diagnostic event is sent.

## Reconsider when

Reporting must be enabled in unsigned distributions, immediate opt-in is required,
new reporting entry points are added, or profile portability needs an explicit
conversion policy.
