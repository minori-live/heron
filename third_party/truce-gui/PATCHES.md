# Heron patch: Windows embedded host scale

Source: published `truce-gui` **6.3.0**, using its normalized Cargo manifest.

- Registry checksum: `d1c02b25b56744d33cda126dba764bff6dd00839dbf94d322fd5c646a926d39d`
- Upstream repository: <https://github.com/truce-audio/truce>
- Upstream commit: `ff6b573c7d845638656b03bbe4b4436559dd9725`
- Upstream path: `crates/truce-gui`
- Published license metadata: `LicenseRef-TruceLicense-1.0`

The published crate omitted its license text. `LICENSE` is copied from that
exact upstream commit (Git blob `b759333b753ac8483217e2983fe0afe804c96b6a`).

`src/platform.rs::editor_window_scale` uses an announced, valid host content
scale for Windows embedded editors. The factor includes display DPI and host
zoom. Windows standalone/system mode, unannounced scale, and other platforms
retain their published policy. This pairs with Heron's `baseview-truce` patch,
so native window geometry, layout, rendering and mouse input share one scale.

All other source and published Cargo metadata are unchanged. Registry cache
markers, the packaged lockfile and VCS metadata are omitted; provenance from the
published VCS metadata is recorded above. Remove both patches together after
an upstream release supplies the equivalent Windows behavior and Heron's
packaged native-editor regression passes with that release.
