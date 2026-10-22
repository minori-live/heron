# Nix distribution

Heron's Nix package lives in this repository's root flake and builds the
selected Heron source revision for Linux and macOS. This document owns the
packaging contract, dependency pins, and Nix validation workflow.

## Package contract

The flake supports `x86_64-linux`, `aarch64-linux`, `aarch64-darwin`, and
`x86_64-darwin`. It uses the source in the flake checkout, the checked-in
`Cargo.lock` and `pnpm-lock.yaml`, and the repository's existing build scripts
to produce:

- the Rust `@heron/dsp-node` addon and native probes;
- the project database template;
- the Electron main, preload, and renderer bundles;
- on Linux, the application directory assembled by electron-builder, with its
  desktop entry and icons;
- on macOS, `Heron.app` plus a `bin/heron` wrapper.

Bundled plug-ins come from the platform archive in `heron-plugins.lock.json`
(`linux-x64`, `linux-arm64`, or `macos-universal`) and stay inside the
application: `lib/heron/resources/plugins` on Linux and
`Heron.app/Contents/Resources/plugins` on macOS. The NixOS module, the
nix-darwin module, and the home-manager module install that package. They do
not copy plug-ins to `/usr/lib/vst3` or `/Library/Audio/Plug-Ins`. The locked
runtime archive is VST 3. Audio Unit (`.component`) downloads are not part of
that lock and are not installed. Heron loads the bundled VST 3 plug-ins from
the application.

The application version comes from the checkout's `VERSION`. The Nix package
does not download a Heron AppImage or depend on a corresponding GitHub Release
already existing. A branch revision can therefore be built before it is tagged.

`flake.lock` pins nixpkgs. Cargo dependencies use `cargoLock` (`importCargoLock`):
each crate checksum comes from `Cargo.lock`. pnpm dependencies are fetched the
same way: each registry package in `pnpm-lock.yaml` is a `fetchurl` whose hash
is that entry's `resolution.integrity`. There is no aggregate pnpm store hash.
The VST3 and ARA SDK sources have fixed revisions and hashes. Built-in plug-ins retain the
independent `heron-plugins` release contract: the Nix package fetches the Linux
or macOS runtime assets selected by `heron-plugins.lock.json`, using the per-asset
`sha256` digests written into that lock. These upstream assets are build inputs,
separate from Heron's own application output.

`nixpkgs` (nixos-unstable) supplies the build toolchain and Electron runtime
for Linux and Apple Silicon. That revision no longer provides Rust, Node, or
Electron for `x86_64-darwin`. Intel Macs use the separate
`nixpkgs-intel-darwin` input, pinned to `nixpkgs-26.05-darwin`, the last
nixpkgs release that builds those tools for Intel. The mise lock
continues to govern ordinary development. These pins make the
inputs fixed and allow offline source compilation. They do not currently
guarantee byte-identical independent rebuilds: PGlite templates contain database
initialization metadata and archive timestamps.

## Revisions and releases

`nix run github:minori-live/heron` builds the selected default-branch revision.
Use `github:minori-live/heron/vX.Y.Z` for a release tag or an exact commit to
select a particular source revision. NixOS, nix-darwin, and home-manager
consumers record that revision in their own flake lockfiles.

The tagged Publish workflow continues to validate, test, and build installers,
stage update manifests, and create a draft GitHub Release. Nix packaging does
not write back application hashes, move the version tag, or update `main`.
Homebrew Tap notification and update-manifest promotion remain separate steps
after the Release is published.

## Updating dependencies

A `pnpm-lock.yaml` update does not edit [`nix/sources.nix`](../../nix/sources.nix).
The package reads each registry package's `resolution.integrity` and fetches
that tarball. `Cargo.lock` is already imported with `cargoLock`, which checks
each crate checksum from the lockfile; this repository has no git crate that
would need `outputHashes`. A dependency-store fetch alone does not validate
the native addon or Electron application. When updating VST3 or ARA, update their
fixed hashes in `nix/sources.nix`. Built-in plug-in archive hashes are
not stored there: `pnpm plugins:update` writes Nix SRI digests into
`heron-plugins.lock.json`, and the package derivation reads them from that lock.
Bump `nixpkgs-intel-darwin` on its own when the Intel toolchain should move;
it does not follow `nixpkgs`. Validate both Linux architectures and the native
macOS build after any of these input changes. `x86_64-darwin` is evaluated in
CI; compiling it needs an Intel Mac or another `x86_64-darwin` builder.

## Validation

`ci.yml` calls the Nix reusable workflow. Its native Linux x64 and arm64 jobs,
and its Apple Silicon job, run `nix flake check` and build `.#heron`, so each
of those systems compiles the package rather than only evaluating its
derivation. The Linux x64 job also evaluates the `aarch64-darwin` and
`x86_64-darwin` derivations. `nix flake check` includes a module evaluation
that enables and disables `darwinModules.heron` without building Heron for
that check. Locally, on Linux or Apple Silicon:

```sh
nix fmt
nix flake check --print-build-logs
nix build .#heron --print-build-logs
```

`nix flake check` builds the checks for the host system; it does not establish
that the other architectures build. Evaluate an architecture this machine
cannot run with `nix eval --raw .#packages.<system>.heron.drvPath`. Use the
corresponding CI job or a native builder for build evidence. Record the exact
commit and successful build jobs in the pull request. Evaluation alone is not
build evidence, and headless CI does not replace interactive audio-device and
plug-in-editor validation. The macOS package is ad-hoc signed, not Developer
ID signed or notarized.
