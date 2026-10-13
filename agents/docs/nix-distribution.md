# Nix distribution

Heron's Linux Nix package lives in this repository's root flake and builds the
selected Heron source revision. This document owns the packaging contract,
dependency pins, and Nix validation workflow.

## Package contract

The flake supports `x86_64-linux` and `aarch64-linux`. It uses the source in the
flake checkout, the checked-in `Cargo.lock` and `pnpm-lock.yaml`, and the
repository's existing build scripts to produce:

- the Rust `@heron/dsp-node` addon and native probes;
- the project database template;
- the Electron main, preload, and renderer bundles;
- the application directory assembled by electron-builder, with its desktop
  entry and icons.

The application version comes from the checkout's `VERSION`. The Nix package
does not download a Heron AppImage or depend on a corresponding GitHub Release
already existing. A branch revision can therefore be built before it is tagged.

`flake.lock` pins nixpkgs. Cargo and pnpm dependencies remain tied to their
lockfiles; the pnpm dependency store has a fixed content hash. The VST3 and ARA
SDK sources also have fixed revisions and hashes. Built-in plug-ins retain the
independent `heron-plugins` release contract: the Nix package fetches the Linux
runtime assets selected by `heron-plugins.lock.json`, with fixed hashes for
each architecture. These upstream assets are build inputs, separate from
Heron's own application output.

## Revisions and releases

`nix run github:minori-live/heron` builds the selected default-branch revision.
Use `github:minori-live/heron/vX.Y.Z` for a release tag or an exact commit to
select a particular source revision. NixOS and home-manager consumers record
that revision in their own flake lockfiles.

The tagged Publish workflow continues to validate, test, and build installers,
stage update manifests, and create a draft GitHub Release. Nix packaging does
not write back application hashes, move the version tag, or update `main`.
Homebrew Tap notification and update-manifest promotion remain separate steps
after the Release is published.

## Updating dependencies

Keep dependency lockfile changes and their hashes in
[`nix/sources.nix`](../../nix/sources.nix) in the same change. When updating pnpm
dependencies, update `pnpm-lock.yaml`, temporarily set `pnpmDeps.hash` to
`lib.fakeHash` in `nix/package.nix`, and request that fixed-output derivation:

```sh
nix build .#heron.pnpmDeps --print-build-logs
```

Copy the reported actual hash into the `pnpm` pin in `nix/sources.nix`, restore
`pnpmDeps.hash = sources.pnpm`, and build the complete package. A
dependency-store build alone does not validate
the native addon or Electron application. When updating VST3, ARA, or the
built-in plug-ins, update their corresponding fixed hashes as well and validate
both Linux architectures.

## Validation

`ci.yml` calls the Nix reusable workflow. Its native Linux x64 and arm64 jobs
run `nix flake check` and build `.#heron`, so each supported architecture
compiles the package rather than only evaluating its derivation. Locally, on
either supported Linux architecture:

```sh
nix fmt
nix flake check --print-build-logs
nix build .#heron --print-build-logs
```

`nix flake check` builds the checks for the host system; it does not establish
that the other architecture builds. Use the corresponding CI job or a native
builder for that evidence. Record the exact commit and successful build jobs
in the pull request. Evaluation alone is not build evidence, and headless CI
does not replace interactive audio-device and plug-in-editor validation.
