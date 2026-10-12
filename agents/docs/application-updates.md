# Application updates

Main owns update state and installation admission. [ADR-0006](adr/0006-tagged-release-updates.md)
explains the distribution and explicit-install choice; [CI](ci.md) owns publishing.

## Eligibility and distribution

Only tag-push publishing sets `HERON_RELEASE_BUILD`, validates `vVERSION`, and
embeds version/channel in main. The installed application must match that
version. Development, ordinary CI and local packages never instantiate the
updater; Linux additionally requires the AppImage environment.

The locked electron-builder/electron-updater stack uses Windows NSIS, universal
macOS DMG plus update ZIP, and Linux x64/arm64 AppImages. macOS requires Developer
ID signing and notarization; Windows retains the unsigned packaging policy.
Supported versions are `X.Y.Z` and `X.Y.Z-alpha.N/beta.N/rc.N`. Stable excludes
prereleases; alpha may advance to beta/stable, beta to stable, and rc follows rc.
Downgrades are disabled after channel assignment.

The bundled generic provider reads `https://heron.minori.live/updates/`.
Manifests reference absolute public GitHub Release installer URLs; the renderer
cannot supply a feed or token. Generate with `--publish never` and validate
channel files, referenced sizes and metadata before uploading. Linux uses
separate `CHANNEL-linux.yml` and `CHANNEL-linux-arm64.yml`.

Stage versioned manifests on `update-manifests` before draft Release creation.
Release assets include installers and the macOS ZIP, excluding manifests and
blockmaps. Publication promotes staged manifests to `current/` and deploys them
with Pages. Ordinary docs deployments preserve that feed. Differential downloads
are disabled because blockmaps are not distributed. Never overwrite published
Releases; corrections use higher versions.

The historical 0.5.1 GitHub-provider build and earlier non-enabled packages need
one manual installation to enter the Pages feed; later Pages builds update
through it. A draft Release alone does not advance the feed.

## Scheduling and installation

Automatic checks start after startup and repeat every four hours. Checks and
downloads wait for 30 seconds without transport, recording or background activity;
failed activity lookup defers work. Playback starting later does not cancel a
download already in progress. Manual checks remain available. Disable both
`autoDownload` and `autoInstallOnAppQuit`.

Settings and the persistent ready notice subscribe to the same state. Only
**Restart and update** admits installation. Renderer runs normal save/discard/
cancel and project close. Main independently refuses open projects or active
audio, gates new mutations, drains admitted work and rechecks closure. Await
audio shutdown and strict worker exit before `quitAndInstall(false, true)`.
Ordinary quit must not inherit a cancelled installation intention.

## Receipts and recovery

Requests target the desktop-session resource, carrying expected revision and
idempotency key. Events carry epoch and monotonic revision. Admission commits the
start of work, not completed installation. The bounded session registry retains
1,024 receipts, replays duplicates without side effects and rejects excess unique
requests. Snapshot reads reconcile missed acknowledgements/events. This registry
has a different lifetime from project-command transfer receipts.

Public states/failures are typed and localized; raw updater errors remain main
logs. Check/download failures are retryable. Unconfirmed shutdown or installer
failure quarantines updating until relaunch; failed preparation never starts the
installer. Once native shutdown starts, mutations stay blocked and ordinary quit
remains available. If an admitted document open wins before shutdown, release
the gate so that document can be saved. The updater owns download caching and
verification; installation replaces application files, not project data.

Installed N-to-N+1 upgrades on Windows, signed macOS and both Linux architectures
must cover offline checks, interrupted downloads and cancelled saves. Unit tests
cannot establish installed upgrade behavior; release evidence remains separate.
