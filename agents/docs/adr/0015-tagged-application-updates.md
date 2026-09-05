# ADR-0015: Update installed tagged releases through GitHub Releases

- Status: Accepted
- Date: 2026-09-06
- Owner: Heron maintainers

## Context

The release workflow already validates v-prefixed tags, builds NSIS, universal
macOS and two AppImage architectures, and creates a draft GitHub Release after
tests pass. Downloading installers manually is unnecessary for existing users.
Updates must not interrupt audio work or bypass project persistence and shutdown.

## Decision

Use electron-builder 26.16.0 and electron-updater 6.8.9. Builder 27 and updater 7
remain prereleases and are deferred. Keep the existing NSIS/AppImage targets;
add the ZIP required by macOS updates alongside DMG. macOS releases retain
mandatory Developer ID signing and notarization. Windows retains its existing
unsigned packaging policy; updater checksums are not a substitute for signing.

Only the tag-push publish workflow sets HERON_RELEASE_BUILD. The main bundle
embeds a version/channel after validating that the push ref equals vVERSION.
An installed package must also match that embedded version. Development,
ordinary CI and local packages never instantiate the updater. Linux additionally
requires an AppImage environment. The first update-enabled release must be
installed manually by users of older builds.

Supported release versions are X.Y.Z and X.Y.Z-alpha.N/beta.N/rc.N. Stable clients
exclude prereleases. Prerelease clients use the corresponding GitHub updater
channel policy (alpha may advance to beta/stable; beta to stable; rc follows rc).
Downgrades are disabled after assigning the channel. No renderer-provided feed
URL or authentication token is accepted. The bundled app-update.yml points to
the public minori-live/heron GitHub release assets.

Builder generates metadata with --publish never. CI checks each platform's
channel file, referenced artifact sizes and SHA-512 hashes before uploading.
Linux x64 uses CHANNEL-linux.yml, arm64 uses CHANNEL-linux-arm64.yml, avoiding
merge collisions. Upload installers, ZIPs, blockmaps and channel metadata to
the existing draft release; publishing that complete draft is the exposure
point. Published releases cannot be overwritten by the workflow.

Main owns the update state. Automatic checks begin after startup and repeat
every four hours; a 30-second idle timer starts checks/downloads only when
transport, recording and background operations are inactive. Activity lookup
failure defers work. Starting playback after a download starts does not cancel
that download. Manual checks remain available. Set autoDownload=false and
autoInstallOnAppQuit=false; downloading does not authorize installation.

The settings page and persistent ready notice share a Pinia subscription.
Installation requires the explicit Restart and update action. The renderer
first reuses the normal save/discard/cancel and project-close workflow. Main
independently rejects installation with an open project or active audio work.
It blocks new mutation RPCs, drains admitted mutations, rechecks project closure,
then waits for audio shutdown and strict project-worker termination. Only after
successful preparation does it call quitAndInstall(false, true). Ordinary quit
must never inherit a cancelled installation intent.

## Protocol and failure semantics

Updater commands and snapshot reads target the explicit desktop-session ref.
Events carry its epoch and monotonically increasing revision. Mutations require
an expected revision and idempotency key. Command admission is the commit point
for starting an operation, not a claim that installation finished. Receipts are
retained for the session (bounded at 1024; further unique requests are rejected)
and duplicates replay without repeating side effects. Snapshot reads reconcile
lost acknowledgements and events. Raw updater errors are logged only in main;
the renderer receives serializable states, failure codes and localized messages.

Check/download failures retain a retryable error state. An unconfirmed shutdown
or installer failure quarantines updating until relaunch; the installer is never
started after failed preparation. Once native shutdown starts, normal mutations
remain blocked and ordinary quit is available. If an admitted open request won
the race before native shutdown, release the mutation gate so its project can
still be saved. Temporary downloads and verified download caching belong to
electron-updater. Installation replaces the application, not user project data.

## Alternatives and consequences

Direct Electron autoUpdater lacks our existing Linux packaging integration.
A separate update server adds deployment responsibilities without a current
requirement. Automatically installing on quit introduces an implicit commit
point incompatible with audio work and save cancellation.

Updates require access to public GitHub releases and compatible platform packages.
The update runtime is confined to Electron main; no helper process, native ABI,
audio callback or project schema changes are introduced. A failed release is
fixed with a higher version, not a client downgrade.

## Verification and reconsideration

Unit tests cover release eligibility, idle work, duplicate requests, save
cancellation, mutation draining and failed shutdown. Build and package checks
validate artifact metadata. Before publishing the first update-enabled release,
perform installed N to N+1 upgrades on Windows, signed macOS, Linux x64 and
Linux arm64, including interrupted downloads, offline checks and cancelled saves.
Cross-platform installed upgrades require those hosts and signed release assets;
unit tests alone do not establish them.

Revisit when builder 27 becomes stable, Windows signing is introduced, additional
release channels are needed, or GitHub hosting no longer meets distribution needs.
