# ADR-0033: Windows native editor presentation surfaces

- Status: Accepted
- Date: 2026-10-12
- Owners: project maintainers
- Scope: Windows native VST3 and CLAP editor presentation
- Related: [Independent editor windows](0018-independent-plugin-editor-windows.md)

## Context

FabFilter Pro-Q 4 initializes and attaches successfully on Windows, but its
OpenGL editor is blank beneath Electron's Chromium composition surface. Raising
and clipping the native child exposes its background without restoring the
complete interface. The same loaded editor renders correctly in an ordinary
Win32 window and when its container becomes a separate native popup surface.

Successful VST3 attachment therefore does not establish visible rendering.
Chromium child-window names, internal composition objects, or globally disabling
graphics acceleration are not suitable compatibility contracts for the host.

## Decision

Keep the independent Electron `BaseWindow` as the owner of each plug-in editor.
On Windows, Rust presents the plug-in in a borderless owned Win32 popup placed
over the native content region below the separate host toolbar. The plug-in
still attaches its child HWND to Heron's container through the existing API.
The popup is a tool window, has no independent taskbar entry, and is not globally
topmost. It remains on the same Electron UI thread and message loop.

Owner window notifications synchronize native position and visibility, including
move, resize, hide, minimize, restore and DPI changes. Position tracking must not
depend on sending an unchanged layout through Electron's layout cache. Keyboard
focus belongs to the plug-in child; closing the native surface delegates to the
owner's existing close workflow. Detach the plug-in before removing native
callbacks and destroying its container, then unregister and destroy the owner.

This changes presentation inside an existing editor. Instance lifetime, toolbar
actions, generic parameter fallback, audio callbacks, IPC and persisted project
state retain their existing contracts. macOS and Linux retain their existing
platform presentation paths.

## Alternatives considered

- Child HWND restacking and clipping alone do not restore Pro-Q 4's full UI.
- Changing FabFilter's global graphics settings affects other applications and
  does not repair Heron's hosting contract.
- Disabling Chromium graphics acceleration changes the whole application.
- Discovering or hiding Chromium's private compositor HWNDs couples hosting to
  implementation details outside Electron's native-window API.

## Verification

Native Windows tests cover ownership, geometry, visibility and teardown through
`NativeContainer`. Local Pro-Q 4 smoke checks cover first attachment, switching
between native and parameter modes, host zoom, interaction, repeated-open focus
and teardown.
Capture the visible desktop region: capturing only the Electron owner's surface
can omit its independently composed native editor and toolbar.

These checks establish the exercised host lifecycle and installed plug-in
compatibility; they do not prove every graphics driver or third-party editor.

## References

- [Win32 owned windows](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)
- [DirectComposition HWND presentation and child clipping](https://learn.microsoft.com/en-us/windows/win32/api/dcomp/nf-dcomp-idcompositiondevice-createtargetforhwnd)
