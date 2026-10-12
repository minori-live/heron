# ADR-0036: Startup progress locale

- Status: Accepted
- Date: 2026-10-12
- Owners: project maintainers
- Scope: locale presentation in the existing startup progress event
- Related: [ADR-0005](0005-ui-boundary-and-application-preferences.md)

## Context

Main translates startup progress using the saved application language. The splash
renderer previously received the translated strings without their language and
always selected English document metadata and fonts. Its narrow preload API only
subscribes to progress; it does not expose application settings.

## Decision

Include the existing `AppLocale` value as a required `locale` field in
`StartupProgressSnapshot`. Main reads the saved language before constructing the
initial progress snapshot. Every subsequent snapshot retains that locale.

The splash renderer uses this field for its document language, font selection,
and localized window title. Before the first snapshot arrives it uses the existing
English default. Progress ordering, resource authority, and the read-only preload
subscription retain their existing behavior. This adds no request, mutation, or
persistence state.

Main, preload, and splash ship together. They adopt the added observation field in
the same release; mixed-version processes are not supported. A renderer reload
receives the current snapshot through the existing startup publication path.

## Alternatives rejected

Reading settings from the splash would broaden its API solely for presentation.
Inferring language from translated text would fail for product names and strings
shared by multiple languages. A URL parameter would require changing the trusted
renderer URL policy.

## Consequences

All startup snapshot producers and fixtures must include the language. Future
changes to startup localization must keep the locale and translated copy aligned.

## Verification

Main tests assert that startup observations carry the language used for their
labels. The splash test delivers a Chinese progress event and checks the applied
renderer language. Type checks cover the required field across producers and
consumers.

## Reconsider when

Startup processes can run independently versioned bundles, or the splash gains a
separate authorized settings initialization contract.
