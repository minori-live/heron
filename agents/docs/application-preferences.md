# Application preferences and onboarding

Electron main validates and atomically persists application preferences through
its revisioned settings resource. Renderer state holds drafts and presentation;
it does not establish a second settings store in localStorage or a project.

## Commit and failure behavior

Settings mutations carry explicit resources, expected revisions, operation IDs
and idempotency keys. The settings file's atomic rename is the durable commit.
Typed terminal results and reconciliation distinguish rejected writes from
committed changes whose acknowledgement failed. A later directory-sync failure
does not undo rename. Consent observers run after rename so revocation reflects
the actual commit.

## Welcome setup

`welcomeCompleted` and `diagnosticsEnabled` default to false, including missing
or malformed legacy values. Keep existing valid appearance/language choices.
Setup gates workspace and creative/settings commands until completion; closing,
quitting, full screen and About remain available. Loading failure shows Retry
and does not imply completed setup.

Theme/language preview stays local. One mutation saves appearance, language,
consent and completion; failed saving retains the editable draft. Duplicate
Continue and consent actions are disabled while saving. General settings uses
the same committed consent value and retains it after a rejected update.

Opt-out uses **Continue**. Opt-in uses **Save and restart** because reporting
initializes on the next launch. Request restart only after known durable save.
After success, setup remains visible while restart is pending/blocked, with retry
and continue-later choices. Persisted completion suppresses setup next launch
even if this restart was cancelled. Saving consent does not itself send a report.

Restart uses project close and main's exit lifecycle. Gate new mutations, drain
admitted work excluding the restart request, and recheck service/document safety.
Duplicate requests cannot schedule duplicate launches. Before teardown, failure
is retryable; after scheduling relaunch, finish existing cleanup without reopening
a partially stopped runtime. Renderer reload is not application restart.
See [crash reporting](crash-reporting.md) for consent epochs and reporting authority.

## Tutorials

Tutorial IDs are a closed shared union. Completion stores a nonnegative version,
not a boolean; missing preferences enable automatic Studio Basics onboarding.
Main persists them using the settings protocol. Project contents and transport
are never modified by replay.

The driver.js adapter lives inside shared UI and owns transient browser
highlighting/popovers and cleanup. Desktop supplies view models and intents.
It cannot persist progress or access native/audio APIs. Dismissal suppresses
automatic start for that renderer session; final completion commits the version.
Help replay may ignore automatic-start/completion settings. Route or application
teardown removes transient UI. See [design system](design-system.md) for shared
interaction ownership and [localization](localization.md) for startup language.
