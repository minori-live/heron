# Built-in plug-in distribution

The producer is [heron-plugins](https://github.com/minori-live/heron-plugins).
It owns plug-in sources and releases; Heron owns integration with its embedded
audio runtime. See [ADR-0031](adr/0031-artifact-delivered-built-in-plugins.md).
Plugin engineering, testing, architecture and native UI rules are maintained in
the producer's [documentation index](https://github.com/minori-live/heron-plugins/blob/main/agents/docs/README.md).
Heron's [EQ integration notes](heron-eq.md) retain host and fitted-preset acceptance;
plugin DSP/editor requirements live in the producer.

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

Configure `HERON_PLUGINS_SYNC_TOKEN` only in `heron-plugins`, using a fine-grained
PAT limited to `minori-live/heron`: Contents write and Pull requests write.
The producer's stable-release workflow checks out Heron's trusted main and runs
the consumer-owned `plugins:update` and `plugins:prepare` commands. It verifies
the latest stable release and maintains the `dsh0416/update-heron-plugins` branch
and one manually merged PR. The PAT makes normal Heron PR CI run automatically.
Heron needs no synchronization secret or release-notification receiver.

Deploy the consumer scripts and initialized lock on Heron main before relying
on automatic updates. Bootstrap the first release manually using the commands
above; a producer update failure does not revoke its published release. Retry
the producer's workflow_dispatch after bootstrap or a failed update. Repeated
runs preserve the existing upgrade commit when main and the selected lock are
unchanged, and recover a missing PR after a successful branch push. Downgrades
and same-version source or checksum changes are rejected against both main and
the pending upgrade.

## First cutover and validation

Producer CI and signing configuration must be operational before Heron selects
the release. Validate old projects, built-in VST3 probe/editor and audio smoke,
and full `mise run check`. Universal verification also checks downloaded plug-in
slices. Windows native runtime builds retain their ASIO requirements.

The producer's release operations document lists Apple, validation and
AAX configuration. AAX remains disabled until its signed bundles pass the
required validator and formal Pro Tools smoke. Published assets are immutable;
enabling AAX creates a new producer version.
