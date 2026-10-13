# Nix distribution

Heron's Linux Nix package lives in this repository's root flake. Application
versions and build artifacts remain owned by the tagged GitHub Release flow.
This document owns the packaging contract and how the release pin is written.

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
The package reads that pin (not the development `VERSION` file) so mid-cycle
version bumps on `main` do not break `nix run` before the next tag ships.
`flake.lock` pins nixpkgs only.

## Release flow

AppImage digests exist only after the Publish workflow builds installers. The
pin therefore cannot live in the maintainer's pre-tag version bump commit.
Instead, Publish writes it as part of creating the draft release:

1. Update `VERSION` and synchronize package versions using existing release
   tooling, then push the matching v-prefixed tag.
2. Publish validates, tests, and builds installers (including both Linux
   AppImages).
3. Before creating or updating the draft GitHub Release, Publish hashes the
   local AppImages, writes `nix/release.nix`, commits that pin on top of the
   tagged revision, force-updates the tag to the pin commit (so
   `github:minori-live/heron/vX.Y.Z` is self-contained), and fast-forwards
   `main` when the tag still pointed at `main`'s tip.
4. Publish creates or updates the draft Release for review. Homebrew Tap
   notification and update-manifest promotion remain separate steps after the
   Release is published.

No extra secrets are required; the job uses `GITHUB_TOKEN` with `contents:
write`. There is no post-release sync PR. Draft rebuilds may rewrite the same
version's digests; stable downgrades of the pin are rejected.

If `main` moved past the tagged commit before Publish finished, the pin remains
on the tag and Publish warns; cherry-pick the pin commit onto `main` so
`nix run github:minori-live/heron` tracks the latest release.

## Validation

`ci.yml` calls the Nix reusable workflow, which runs `nix flake check` and
builds `.#heron` on Linux, then smoke-tests the wrapped binary. Locally:

```sh
nix flake check
nix build .#heron
./result/bin/heron --version
```

To rewrite the pin from local AppImages (as Publish does):

```sh
mise run nix:pin -- 0.8.0 path/to/release-assets
```

## Candidate durable decision

Shipping Linux through an in-repo flake that wraps published AppImages (rather
than a separate binary cache, nixpkgs upstreaming, or a from-source Nix build),
and writing the pin inside Publish so tagged revisions stay self-contained, is
a durable distribution choice. Note it in PR descriptions as a candidate ADR;
do not file or accept an ADR without an explicit maintainer request.
