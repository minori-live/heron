# ADR-0007: Linux native editor compatibility tiers

- Status: Proposed
- Date: 2026-09-06
- Owners: project maintainers
- Current specification: [owning document](../native-call-boundary.md)
- Editorial consolidation: 2026-10-12; preserves the existing decision/status
- Historical text: [before consolidation](https://github.com/minori-live/heron/blob/4924b0eba3e8800c1a8ec4495a0b5e7fc99831ee/agents/docs/adr/0007-linux-editor-compatibility.md)

## Context

Current Linux native hosting uses X11/XEmbed under X11/XWayland. Pure Wayland
attachment is rejected with generic parameter fallback. Wayland surfaces belong
to connections and cannot be reparented as global X11 IDs. Electron's X11 handle
API does not establish a native Wayland embedding contract.

## Proposed decision

Retain X11/XWayland native editors and generic fallback, and consider a third tier
for conforming native Wayland plug-ins using `IWaylandHost`, a per-editor owned
connection and repository-owned nested compositor integration. Keep the Electron
UI loop, instance ownership and bounded drain. No helper, private Ozone ABI or
second event loop is proposed. Backend selection would be explicit at launch,
without silent mid-session relaunch.

## Alternatives and consequences if accepted

Private compositor access has unsupported lifetime semantics. Floating legacy
windows do not satisfy embedding/focus/resize behavior. Generic-only support
forever discards custom editors, while permanent XWayland blocks a native path.
Native hosting adds significant compositor/input/popup/scale/teardown work.

This remains Proposed. Current source support does not imply acceptance of the
launch policy or native Wayland tier. Acceptance needs conforming fixtures and
owned attach/input/focus/resize/popup/cleanup evidence, preserving fallback and
existing audio behavior. The original technical references and test outline are
available through this record's history link.

## Reconsider when

A stable Electron embedding API, changed VST contract or demonstrated plug-in
adoption changes the proposed ownership and compatibility cost.
