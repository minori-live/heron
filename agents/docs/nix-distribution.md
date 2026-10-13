# Nix distribution

Heron's Linux Nix package lives in this repository's root flake. Application
versions and build artifacts remain owned by the tagged GitHub Release flow.
This document owns the publication contract, setup and recovery.

## Package contract

The flake packages the official Linux AppImages
(`Heron-<version>-linux-x86_64.AppImage` and
`Heron-<version>-linux-arm64.AppImage`) with `appimageTools.wrapType2`, a
`.desktop` entry, and icons. The Nix output is intended to match the binary
users get from GitHub Releases and the website.

Building the Electron renderer plus Rust `@heron/dsp-node` addon from source
under Nix is intentionally omitted: it would reimplement the mise/pnpm/Cargo
release pipeline, take much longer in CI, and diverge from the published
artifacts other channels ship.

Pinned version and content hashes live in [`nix/release.nix`](../../nix/release.nix).
`flake.lock` pins nixpkgs only.

## Release flow

1. Update VERSION and synchronize package versions using existing release tooling.
2. Push the matching v-prefixed tag. The publish workflow validates and uploads
   installers to a draft Release.
3. Publish the reviewed Release. `update-nix-flake.yml` synchronizes
   `nix/release.nix` for non-prerelease v-prefixed releases independently of
   Homebrew Tap notification and update-manifest promotion.
4. The workflow re-reads the latest stable Release, validates Linux AppImage
   metadata, and opens or updates a single release PR. Merge advances the flake
   that `nix run github:minori-live/heron` resolves from `main`.

Preparing an unreleased development version does not update the flake pin.
Drafts and prereleases do not advance it. Preserve published assets; the sync
rejects same-version asset digest changes and automatic downgrades. Digests
come from GitHub's release asset API (same source as the Homebrew Cask).

## Setup and recovery

Configure `NIX_SYNC_TOKEN` with a fine-grained PAT whose resource owner is
minori-live, whose only selected repository is heron, and whose permissions are
Contents write and Pull requests write. The workflow uses it so the update PR
can start required checks without the approval delay that applies to PRs opened
with `GITHUB_TOKEN`. No custom GitHub App is needed.

If synchronization fails, fix the reported credentials/configuration and run:

```sh
gh workflow run update-nix-flake.yml --repo minori-live/heron --ref main
```

The retry reconciles the latest stable Release without a tag input.
Notification failure does not unpublish the Release or block application update
manifests or Homebrew Tap synchronization. The previous `nix/release.nix` pin
remains until a successful sync PR merges. There is no scheduled compensation.

## Validation

`ci.yml` calls the Nix reusable workflow, which runs `nix flake check` and
builds `.#heron` on Linux, then smoke-tests the wrapped binary. Locally:

```sh
nix flake check
nix build .#heron
./result/bin/heron --version
```

Publication has no atomic commit across the Release and the flake pin:
notifications may lag, credentials expire, and manual dispatch reconciles the
latest state.

## Candidate durable decision

Shipping Linux through an in-repo flake that wraps published AppImages (rather
than a separate binary cache, nixpkgs upstreaming, or a from-source Nix build)
is a durable distribution choice. It is noted here and in PR descriptions as a
candidate ADR; do not file or accept an ADR without an explicit maintainer
request.
