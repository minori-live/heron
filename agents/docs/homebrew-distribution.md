# Homebrew distribution

Heron's macOS Cask is maintained in
[`minori-live/homebrew-tap`](https://github.com/minori-live/homebrew-tap).
Application versions and build artifacts remain owned here. See
[ADR-0011](adr/0011-homebrew-distribution.md) for the publication contract.

## Release flow

1. Update VERSION and synchronize package versions using existing release tooling.
2. Push the matching v-prefixed tag. The publish workflow validates, signs,
   notarizes, and uploads artifacts to a draft Release with SHA256SUMS.
3. Publish the reviewed Release. `notify-homebrew-tap.yml` notifies the Tap for
   non-prerelease v-prefixed releases independently of update-manifest promotion.
4. The Tap re-reads the latest stable Release, verifies the downloaded DMG,
   and updates its single release PR. The required Tap utility check gates auto-merge.

Preparing an unreleased development version does not update the Cask. Drafts
and prereleases do not advance it. Preserve published assets; the Tap rejects
same-version checksum changes and automatic downgrades.

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
