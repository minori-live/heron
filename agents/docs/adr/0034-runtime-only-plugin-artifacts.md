# ADR-0034: Runtime-only plug-in artifacts

- Status: Accepted
- Date: 2026-10-12
- Owners: project maintainers
- Scope: plug-in dependency locks and symbol handling
- Supersedes: plug-in symbol distribution in
  [ADR-0031](0031-artifact-delivered-built-in-plugins.md) and
  [ADR-0032](0032-release-artifact-identity.md)

## Context

Plug-ins are not yet being integrated with Sentry. Their symbol publication,
download and upload pipeline is outside the current release scope.

## Decision

Heron requires only the four VST3 runtime archives. Remove plug-in symbol
downloads, validation and Sentry staging. Keep Heron's application source maps,
native addon symbols, upload configuration and runtime reporting unchanged.

Parse locks into version, source commit and runtime filenames, ignoring obsolete
symbol entries in old locks. Normalize the checked-in lock without changing its
pinned version, commit or runtime assets. Same-version immutability compares
runtime identity on both sides. Archive and native validation remain in force.

## Alternatives rejected

An optional legacy symbol path would preserve the deferred Sentry integration
and its associated build work.

## Consequences

Heron can consume releases with runtime bundles alone. Existing releases remain
usable through their runtime assets; their published files are not modified.

## Verification

Consumer tests cover runtime-only releases and legacy lock normalization.
Application symbol tests continue to cover source maps and native addon files.

## Reconsider when

Plug-in diagnostics has an approved symbol-distribution requirement.
