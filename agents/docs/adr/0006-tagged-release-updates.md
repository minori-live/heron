# ADR-0006: Update installed tagged releases through GitHub Releases

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Scope: implemented update contract; installed upgrade evidence is a separate release gate
- Related: [CI and releases](../ci.md), [Transaction ownership](0001-runtime-ownership-and-transactions.md)

## Context

Existing users need updates without bypassing project saving, audio shutdown,
or the release workflow's complete artifact set. Downloading must not implicitly
authorize installation or make ordinary development packages update-enabled.

## Decision

### Distribution and eligibility

Use the repository-locked electron-builder/electron-updater stack, NSIS on Windows,
DMG plus update ZIP on universal macOS, and x64/arm64 AppImages on Linux. macOS
requires Developer ID signing and notarization. Windows retains its unsigned
packaging policy; checksums do not replace signing.

Only the tag-push publish workflow sets `HERON_RELEASE_BUILD`. Validate push ref
against `vVERSION` and embed the version/channel in main. The installed package
must match that version. Development, ordinary CI and local packages never
instantiate the updater; Linux also requires an AppImage environment. Older
non-enabled builds require manual installation of the first enabled release.

Support `X.Y.Z` and `X.Y.Z-alpha.N/beta.N/rc.N`. Stable excludes prereleases;
alpha may advance to beta/stable, beta to stable, and rc follows rc. Disable
downgrades after channel assignment. The bundled update configuration targets
public `minori-live/heron` GitHub assets, with no renderer-supplied feed or token.

Generate metadata with `--publish never`. Before upload, validate channel files,
referenced sizes and SHA-512 hashes. Linux uses separate `CHANNEL-linux.yml` and
`CHANNEL-linux-arm64.yml`. Upload installers, ZIPs, blockmaps and metadata into
the draft release; publishing the complete draft exposes the update. The workflow
cannot overwrite published releases. Correct bad releases with higher versions.

### Scheduling and installation

Main owns update state. Automatic checks start after startup and repeat every
four hours; checks/downloads wait for 30 seconds without transport, recording
or background activity. Failed activity lookup defers work. Later playback does
not cancel an already-started download. Manual checks remain available.
Set `autoDownload=false` and `autoInstallOnAppQuit=false`.

Settings and the persistent ready notice share a Pinia subscription. Only the
explicit Restart and update action requests installation. Renderer first uses
normal save/discard/cancel and project close. Main independently rejects an open
project or active audio work, blocks new mutation RPCs, drains admitted mutations,
rechecks closure, then awaits audio shutdown and strict worker termination.
Only successful preparation permits `quitAndInstall(false, true)`. Ordinary quit
never inherits a cancelled install intention.

### Protocol and failure behavior

Requests target the desktop-session resource; events include epoch and monotonic
revision. Mutations require expected revision and idempotency key. Admission
commits the start of an operation, not installation completion. Keep bounded
session receipts (1,024); reject additional unique requests and replay duplicates
without side effects. Snapshot reads reconcile missed acknowledgements/events.
Raw updater errors stay in main logs; public states and failures are typed and
localized. These admission receipts differ from project-command transfer receipts.

Check/download errors remain retryable. Unconfirmed shutdown or installer failure
quarantines updating until relaunch, and failed preparation never starts the
installer. Once native shutdown begins, mutations stay blocked while ordinary
quit remains available. If an admitted open won before shutdown, release the gate
so its project can still be saved. electron-updater owns temporary downloads and
verified caching. Installation replaces application files, not project data.

## Alternatives rejected

Electron's direct updater lacks the existing Linux packaging integration. A
separate server adds operational ownership without a demonstrated need. Automatic
installation on quit conflicts with audio work and cancellation of saving.

## Consequences

Updates depend on public GitHub availability and compatible signed/package assets.
Runtime ownership stays in main with no helper, callback or project schema change.
Dependency upgrades and signing-policy changes require their own review; package
manifests and locks, not this ADR, record exact installed versions.

## Verification

Test eligibility, idle scheduling, duplicates, save cancellation, mutation draining,
and failed shutdown. Validate artifact metadata before publishing. Installed
N-to-N+1 upgrades on Windows, signed macOS and both Linux architectures must cover
offline checks, interrupted downloads and cancelled saves. Unit tests alone do
not establish installed upgrade behavior.

## Reconsider when

Updater dependencies require a new integration, Windows signing is introduced,
release channels expand, or GitHub no longer meets distribution requirements.
