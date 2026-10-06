# Crash reporting operations

See [ADR-0027](adr/0027-sentry-crash-reporting.md) for consent, ownership and limits.
The public DSN is in the main diagnostics module. It is not an upload credential.

## Release symbol uploads

Configure the GitHub Actions repository secret `SENTRY_AUTH_TOKEN` with Sentry
release/artifact upload permissions, and repository variables `SENTRY_ORG` and
`SENTRY_PROJECT` for the destination organization/project ID or slug. The token is
only passed to the tagged-release build's symbol-upload step and never packaged.
All three must be supplied together. With none configured, CI logs the missing
configuration and retains `heron-sentry-symbols-<platform>` artifacts for 90 days;
crash events still arrive but Heron frames require uploading the matching symbols.

Tagged builds keep full native debug information, including architecture-specific
macOS dSYMs and Windows PDBs. Packaging smoke builds deliberately strip symbols and
do not upload them. Source maps contain build-injected debug IDs matching shipped
main bundles. `pnpm --filter @heron/desktop upload:sentry-symbols --stage-only` stages
local release symbols without network access. Normal invocation stages and uploads
when all three Sentry environment variables are available.

To upload a retained artifact manually with the locked CLI, extract it and run
`sentry-cli debug-files upload --include-sources --wait <artifact>/native`, followed
by `sentry-cli sourcemaps upload --release heron@<version> --validate <artifact>/main`.
Preserve symbols for supported releases beyond CI retention in your release archive.

## Local validation

`pnpm --filter @heron/desktop test:crash-reporting` runs the real SDK and Electron
against a localhost ingest server in disposable data directories. It deliberately
crashes an isolated Electron test process after loading the native addon, then
relaunches to verify native minidump delivery. It does not use the production DSN.
Linux needs an X server, for example `xvfb-run -a pnpm --filter @heron/desktop test:crash-reporting`.

For production confirmation, install a tagged artifact, explicitly enable crash
reports, restart, reproduce the actual fault and relaunch. Check Sentry's release,
native attachment, architecture and symbolicated Heron frames. Do not deliberately
crash a session containing unsaved creative work.
