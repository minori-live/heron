# ADR-0011: Homebrew distribution

- Status: Accepted
- Date: 2026-09-30
- Owners: project maintainers
- Scope: macOS distribution and cross-repository release synchronization

## Context

macOS users need a Homebrew installation path. Tagged release builds already
produce signed and notarized Universal DMGs with SHA256SUMS. A separate Tap must
not introduce an independent application version or rebuild pipeline.

## Decision

Maintain the Cask in minori-live/homebrew-tap. Heron's published stable GitHub
Release is the distribution authority; its development VERSION may advance
independently. The Tap installs the existing Universal DMG for both architectures.

After publication Heron sends a repository-dispatch event. A fine-grained PAT
limited to the Tap grants notification and PR-write authority. The Tap ignores
event payloads when selecting a version, re-reads the latest stable Release,
verifies assets, and updates one fixed PR. The required Tap utility check gates
auto-merge. Tap CI checks utility types, formatting, and Cask Ruby syntax;
Heron's release pipeline owns application builds, signing, and notarization.

Synchronization rejects drafts, prereleases, downgrades, incomplete assets, and
same-version replacements. Failures preserve the previous Cask; retries reconcile
current state. Publication is asynchronous with no atomic commit spanning
repositories. Manual dispatch is the recovery mechanism; scheduled compensation
is deliberately omitted.

## Alternatives rejected

- Manual versions in both repositories create a second authority and can publish
  a Cask before its assets become public.
- Rebuilding in the Tap duplicates packaging and signing.
- A custom GitHub App adds setup unnecessary for this initial single-Tap source.
- Scheduled polling is omitted at the maintainer's request.

## Consequences

The Tap can temporarily lag a Release; missed notifications or expired credentials
require manual retry. Maintainers must renew the PAT and preserve required checks.
Tap checks do not duplicate application installation or startup validation.
Physical audio-device behavior and installed-version upgrades require validation
on a Mac with the relevant devices.

## Verification

Run Tap formatting and type checks, check the Cask's Ruby syntax, and lint both
repositories' workflows. Synchronization verifies the published DMG's size and
checksum before proposing a new version. Repeated notifications compare release
checksums without downloading the installer again.

## Reconsider when

Multiple apps or channels need a richer manifest, credential renewal becomes
costly, missed notifications justify scheduled compensation, or official
Homebrew Cask maintenance replaces the Tap.
