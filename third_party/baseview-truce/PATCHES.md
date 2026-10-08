# Heron patch: Windows embedded host scale

Source: published `baseview-truce` **0.1.1-truce.13**, using its normalized Cargo
manifest and published MIT/Apache-2.0 licenses.

- Registry checksum: `5dc830ece0415c778e700c97d38bb28f4d8af0280f9d140f50ea094d0fed3e27`
- Upstream repository: <https://github.com/truce-audio/baseview>
- Upstream commit: `a860a62b6471a549f113026b236242a90a3c9d8e`

Implementation changes are confined to `src/win/window.rs`:

- A window opened with a pinned `ScaleFactor` accepts valid host scale updates.
  The scale cell updates immediately so queued logical resizes use the latest
  factor. A deferred `ScaleChanged` task emits `Resized` after the handler borrow
  ends, using its current physical extent without scaling that extent again.
- A nested native message pump leaves deferred tasks queued while the handler
  is borrowed. The outer dispatch drains them after that borrow ends, so a
  `ScaleChanged` notification cannot be popped and silently ignored.
- Native `Focused` and `Unfocused` transitions use the same FIFO queue. A
  reentrant focus change during rendering retains every transition until the
  handler callback returns, so the Iced bridge can cancel interrupted gestures.
  This addresses the [focus reentry review of PR #222](https://github.com/minori-live/heron/pull/222#discussion_r4215168764).
  Heron's `native_focus` regression verifies real loss/gain transitions are
  delivered exactly once, in order, after the active frame callback returns.
- Pinned windows ignore `WM_DPICHANGED`'s DPI-only suggested rectangle because
  the host owns their accepted physical extent. System-scale windows retain the
  published OS DPI behavior.

`src/window.rs` documents the corrected public scale-update behavior.

This pairs with Heron's `truce-gui` patch. Other platforms and all unrelated
source are unchanged. Registry cache markers, the packaged lockfile and VCS
metadata are omitted; provenance from the published VCS metadata is recorded
above. Remove both patches together after an upstream release supplies the
equivalent Windows behavior and Heron's packaged native-editor and
`native_focus` regressions pass with that release.
