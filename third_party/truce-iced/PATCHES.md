# Heron patch: native editor focus-loss interruption

Source: published `truce-iced` **6.3.0**, using its normalized Cargo manifest.

- Registry checksum: `ebce0f17416819460410786fba2f3f6c18f5514f7013da2fe6bcc20a3b4d5295`
- Upstream repository: <https://github.com/truce-audio/truce>
- Upstream commit: `ff6b573c7d845638656b03bbe4b4436559dd9725`
- Upstream path: `crates/truce-iced`
- Published license metadata: `LicenseRef-TruceLicense-1.0`

The published crate omitted its license text. `LICENSE` is copied from that
exact upstream commit (Git blob `b759333b753ac8483217e2983fe0afe804c96b6a`).

On Windows, `src/editor.rs::IcedBaseviewHandler::on_event` forwards baseview's
native `Focused` and `Unfocused` events to Iced's pending window-event queue.
Heron EQ already uses `Unfocused` to cancel its active gesture, restore the retained value and balance
host parameter edits. Without the bridge, moving focus during a native curve
drag leaves its edited value and open host gesture behind. This was observed
in the packaged Windows editor interruption regression while verifying #220.
The paired `Focused` event restores Iced text-input cursor and IME behavior
after the interruption; forwarding only focus loss would strand inputs in the
unfocused state.

Other platforms, all other source, window-event mappings and published Cargo metadata are
unchanged. Registry cache markers, the packaged lockfile and VCS metadata are
omitted; provenance from the published VCS metadata is recorded above. Remove
this patch when an upstream release supplies the equivalent paired event bridge and
Heron's packaged focus-loss interruption regression passes with that release.
