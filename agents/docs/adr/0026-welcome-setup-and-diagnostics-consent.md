# ADR-0026: Welcome setup and diagnostics consent

- Status: Accepted
- Date: 2026-10-06
- Owners: project maintainers
- Scope: first-run preferences and persisted consent; reporting integration is deferred
- Related: [ADR-0005](0005-ui-boundary-and-application-preferences.md)
- Reporting follow-up: [ADR-0027](0027-sentry-crash-reporting.md) (Proposed); the deferred-reporting statements below describe this record's original implementation.

## Context

Users need to choose their theme, interface language, and whether to allow crash
and performance reporting before entering their first session. The existing
welcome route remains the project launcher. Consent must survive restarts and be
editable in settings without tying the renderer to a reporting SDK.

## Decision

Electron main owns two application preferences: `welcomeCompleted` and
`diagnosticsEnabled`. Both default to false, including absent or malformed
values in legacy files. Existing valid theme and language preferences remain
selected when an installation first encounters setup.

The application shell shows welcome setup until completion is committed, even
when a workspace route is requested. Creative and settings commands are held
until completion; closing, quitting, full screen, and About remain available.
Theme and language choices preview locally. Continue submits theme, language,
consent, and completion through one existing revisioned settings mutation.
Its durable commit point is the settings file's atomic rename. Existing resource
handles, operation IDs, idempotency receipts, revision reconciliation, and typed
recoverable/quarantined outcomes apply; this adds no transport or resource type.
There is no external preparation or reporting side effect to abort. A failed
save retains the draft and leaves setup visible for retry. Duplicate Continue
and consent-setting actions are disabled while saving. A settings-load failure
shows a retry action and does not treat missing settings as completed setup.

The Display / General page exposes the same consent control. Its value follows
the committed main snapshot, and a rejected update preserves the previous value.
This release only records consent. It adds no Sentry dependency, initialization,
network reporting, or changes to local performance measurement. Future Sentry
integration must gate crash and performance reporting on explicit committed
consent and respect revocation; that integration requires its own design review.

## Alternatives rejected

### Automatically enable reporting

An absent preference is not affirmative consent. Reporting defaults to disabled.

### Persist each setup choice separately

This would allow completion to diverge from the user's final choices. A local
draft previews appearance and a single mutation commits the completed setup.

## Consequences

Existing installations see setup once after upgrading. Users may continue with
reporting disabled. Both languages and all three themes share controls with
settings, avoiding divergent choices. Reporting remains deferred and the UI
explicitly states that the saved choice applies to a future reporting feature.

## Verification

Main-store tests cover legacy defaults, malformed consent, atomic completion,
restart persistence, and revocation. Renderer tests cover the draft, busy state,
failed save, and retry. Electron E2E covers appearance/language preview, completion,
reload, and editing consent from settings. Type, localization, UI-boundary,
format, lint, and production bundle checks protect integration.

## Reconsider when

Reporting is implemented, consent needs a policy version, or preferences become
account-synchronized instead of local application state.
