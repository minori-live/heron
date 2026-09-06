# ADR-0007: Tier Linux native plug-in editor compatibility

- Status: Proposed
- Date: 2026-09-06
- Owners: project maintainers
- Scope: retained proposal; consolidation does not accept native Wayland support
- Related: [Native boundary](../native-call-boundary.md), [Roadmap](../roadmap.md), [Runtime ownership](0001-runtime-ownership-and-transactions.md)

## Context

The implemented Linux VST3 editor path uses an X11/XEmbed child under Electron
on X11/XWayland. Native Wayland attachment is currently rejected and the generic
parameter editor remains available. A Wayland surface is scoped to its connection;
it is not a globally reparentable X11 window ID.

The VST 3.8 Wayland contract introduces host-owned compositor/connection duties,
including input, focus, popups, scaling and teardown. Electron's documented X11
window handle does not establish an accepted Wayland embedding/lifetime contract.
Private Chromium/Ozone objects would be an unsupported compatibility dependency.

## Proposed decision

Keep three explicit capability tiers:

1. **X11/XWayland native editor:** use a valid X11 parent and
   `kPlatformTypeX11EmbedWindowID`/XEmbed. This remains the existing native-editor
   release evidence path.
2. **Native Wayland editor:** admit only conforming plug-ins through
   `kPlatformTypeWaylandSurfaceID` and `IWaylandHost`, with a per-editor host-owned
   connection and repository-owned nested compositor integration. Do not reparent
   independently connected surfaces or depend on private Electron ABI.
3. **Generic parameter editor:** the recoverable fallback for unsupported backends,
   unmatched capabilities or failed pre-commit attachment. Audio, state and
   parameter control remain usable.

The proposal prefers X11/XWayland when advertising broad third-party custom-editor
support until tier 2 meets acceptance. Native Wayland application mode has narrower
editor capability. Backend choice is explicit at launch; never silently relaunch
or switch after a project opens. This proposed launch policy is not an assertion
that it is already implemented.

Electron continues owning top-level editor lifetime, toolbar, and platform loop.
The embedded runtime owns VST3 views, per-editor Wayland server state and cleanup,
integrated into its existing bounded main-thread drain. There is no second loop,
GUI/audio helper, watchdog, OS shared-memory transport, or renderer-native handle.
A parent surface pointer alone is insufficient: supported embedding must place
the view below the toolbar through a stable owned integration.

Failed attachment must detach the view, close compositor resources and leave
generic editing available, with no orphan surface or ambiguous open state.

## Alternatives considered

- Treating a surface like a global window ID violates its connection/role ownership.
- Private Ozone access gives no supported lifetime or compatibility promise.
- Floating legacy X11 top-level windows over Wayland do not satisfy embedded
  focus, stacking, resize, popup and close semantics.
- A GUI helper conflicts with runtime ownership and does not isolate processing/ARA.
- Generic-only Linux forever discards important custom editors; permanent XWayland
  prevents adoption of a standardized native path.

These remain proposal arguments, not accepted changes to platform support.

## Consequences if accepted

Support claims must distinguish audio/parameter support from editor backend
capability. X11/XWayland remains necessary while plug-in adoption varies.
Native Wayland adds substantial compositor and UI lifetime responsibilities.
Diagnostics and English/Chinese documentation must explain backend and fallback.

## Verification required for acceptance and delivery

Retain official X11/XWayland fixture editor smoke. Add conforming Wayland fixtures
covering capability negotiation, owned connections, subsurface attach, keyboard,
pointer, focus, resize, scale, popups and close. An X11-only fixture must fall back
without crashing or leaking. Exercise repeated open, failed attach, fallback,
close and shutdown under a headless compositor. Inspect for no private ABI,
helper, second loop, renderer handle or callback GUI work. Until that evidence
exists, Wayland evidence demonstrates generic fallback and normal audio only.

Technical references retained from the proposal:

- [VST 3.8 Wayland hosting](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical%2BDocumentation/Change%2BHistory/3.8.0/IWaylandHost.html)
- [VST platform UI types](https://steinbergmedia.github.io/vst3_doc/base/group__platformUIType.html)
- [Wayland core protocol](https://wayland.freedesktop.org/docs/html/apa.html)
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)

## Reconsider when

A stable Electron embedding API, a changed VST contract, measured plug-in adoption,
or a fully accepted isolation architecture changes the required ownership model.
