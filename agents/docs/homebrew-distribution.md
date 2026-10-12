# Homebrew distribution

Heron's macOS Cask is maintained in
[`minori-live/homebrew-tap`](https://github.com/minori-live/homebrew-tap).
Application versions and build artifacts remain owned here. This document owns
the publication contract, setup and recovery.

## Release flow

1. Update VERSION and synchronize package versions using existing release tooling.
2. Push the matching v-prefixed tag. The publish workflow validates, signs,
   notarizes, and uploads installers to a draft Release.
3. Publish the reviewed Release. `notify-homebrew-tap.yml` notifies the Tap for
   non-prerelease v-prefixed releases independently of update-manifest promotion.
4. The Tap re-reads the latest stable Release, validates its asset metadata,
   and updates its single release PR. The required Tap utility check gates auto-merge.

Preparing an unreleased development version does not update the Cask. Drafts
and prereleases do not advance it. Preserve published assets; the Tap rejects
same-version asset digest changes and automatic downgrades. The Tap reads the
DMG digest supplied by GitHub's release API and writes it into the Cask.

## Setup and recovery

Configure `TAP_SYNC_TOKEN` in both repositories with a fine-grained PAT whose
resource owner is minori-live, whose only selected repository is homebrew-tap,
and whose permissions are Contents write and Pull requests write. Heron uses it
only to dispatch the Tap workflow. No custom GitHub App is needed.

Merge the Tap workflow onto its default branch, configure required checks and
auto-merge, and merge the notification workflow here before relying on automatic
updates. The initial Cask can use the existing Release. Full setup instructions
are owned by the Tap's
[maintenance guide](https://github.com/minori-live/homebrew-tap/blob/main/agents/docs/maintenance.md).

If notification fails, fix the reported credentials/configuration and run:

```sh
gh workflow run notify-homebrew-tap.yml --repo minori-live/heron --ref main
```

If notification succeeded but synchronization or PR checks failed, repair the
reported problem and run:

```sh
gh workflow run sync-heron.yml --repo minori-live/homebrew-tap --ref main
```

Both retries reconcile the latest stable Release without a tag input.
Notification failure does not unpublish the Release or block application update
manifests. The Tap preserves its previous Cask until successful synchronization
and merge. There is no scheduled compensation.

## Publication authority and validation

The published stable GitHub Release, not the development VERSION or dispatch
payload, selects the Cask version. Install the existing signed/notarized universal
DMG; the Tap does not rebuild Heron. Validate the API asset size/digest and required
assets before advancing the fixed PR. Synchronization does not need to download
the installer to obtain its SHA256. Reject drafts, prereleases, incomplete assets,
downgrades and same-version replacements. Failure leaves the previous Cask intact.

Heron owns builds, signing and notarization; Tap CI owns utility formatting/types
and Cask Ruby syntax. Installed upgrades and device behavior still require macOS
evidence. Publication has no atomic commit across repositories: notifications may
lag, credentials expire and manual dispatch reconciles the latest state. Renew
the scoped PAT and preserve required checks. Scheduled polling remains omitted.
