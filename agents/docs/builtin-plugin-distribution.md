# Built-in plug-in distribution

The producer is [heron-plugins](https://github.com/minori-live/heron-plugins).
It owns plug-in sources and releases; Heron owns integration with its embedded
audio runtime. See [ADR-0031](adr/0031-artifact-delivered-built-in-plugins.md).

## Dependency preparation

`heron-plugins.lock.json` pins one stable release and all four VST3 runtime and
symbol archives. `release: null` means the first release has not been selected;
native development and packaging must not bypass that gate.

After the producer publishes its first tested release:

```sh
pnpm plugins:update 0.6.4
pnpm plugins:prepare
```

Preparation verifies SHA256, manifest version/source/platform, identities and
binary architecture, then replaces `target/bundles`. The installed inventory is
`target/bundles/bundle-manifest.json`; bundles sit alongside it. There is no
plug-in source fallback. Use `pnpm plugins:prepare --offline` to require existing
verified cached assets, or `--platform macos-universal` for universal packaging.
The ordinary native mise tasks prepare plug-ins automatically.

The suite must contain EQ, Gain, Sine and Metronome with their persisted native
identities. Missing or malformed installed inventory exposes all four as
unavailable entries in the application catalog.

Runtime archives contain only VST3 bundles, notices and inventory. AU and AAX
are standalone producer assets. Heron never downloads them for its application.

## Symbols

Release symbol upload prepares the locked VST3 symbol asset separately. This
does not add symbols to ordinary application resources. Heron's own Sentry
credentials upload both application/addon symbols and the pinned plug-in
symbols to Heron's project. The producer publishes matching debug files and
source bundles; its own Sentry configuration and runtime capture are deferred.

## Automatic upgrade PRs

Configure `HERON_PLUGINS_SYNC_TOKEN` in both repositories with a fine-grained
PAT limited to `minori-live/heron`: Contents write and Pull requests write.
Deploy the Heron receiver workflow on main before enabling producer notifications.
A stable published release sends `heron-plugins-release-published`; the receiver
validates the latest stable release and maintains the
`dsh0416/update-heron-plugins` branch and one PR. The PR runs normal CI and is
merged manually. Repeated notifications are no-ops; downgrades and same-version
checksum changes are rejected. Use workflow_dispatch to retry a failed
notification or dependency update.

## First cutover and validation

Producer CI and signing configuration must be operational before Heron selects
the release. Validate old projects, built-in VST3 probe/editor and audio smoke,
and full `mise run check`. Universal verification also checks downloaded plug-in
slices. Windows native runtime builds retain their ASIO requirements.

The producer's release operations document lists Apple, validation and
AAX configuration. AAX remains disabled until its signed bundles pass the
required validator and formal Pro Tools smoke. Published assets are immutable;
enabling AAX creates a new producer version.
