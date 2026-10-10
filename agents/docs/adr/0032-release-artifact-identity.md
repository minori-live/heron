# ADR-0032: Release artifact identity

- Status: Accepted
- Date: 2026-10-11
- Scope: release assets and built-in plug-in caching

## Decision

GitHub releases publish installers and plug-in archives without a separate
checksum catalog. Heron pins plug-ins by suite version, source commit and asset
filenames, and caches downloads under that version and platform.

Preparation validates extracted manifests, native identities and target
architectures before replacing staging. Symbol preparation matches Debug IDs
to the runtime modules. Invalid archives are removed from the cache; the next
online preparation downloads them again. Valid cached archives support offline
builds.

The release workflows retain signing, notarization and artifact attestations.
Electron's updater metadata and Homebrew's Cask digest remain owned by their
distribution tools. The Tap uses GitHub's asset digest instead of a Heron
checksum catalog.

## Rationale

A second checksum catalog and build-time hashing duplicate the distribution
tools. Version and source identity select the dependency; archive and native
validation determine whether it can be staged.

## Verification

Tests cover cache reuse, invalid archives, staging recovery, release selection
and matching symbols. Real release archives are validated on all four supported
platforms before cutover.
