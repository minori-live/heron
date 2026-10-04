# ADR-0018: Independent plug-in editor windows

- Status: Accepted
- Date: 2026-10-04
- Owners: project maintainers
- Scope: current desktop implementation
- Related: [Plugin Analysis follow-ups](https://github.com/minori-live/heron/pull/193)

## Context

Plugin Analysis is independent of the project Editor, but every plug-in editor
was created as a child of the main Editor window. Activating an Analysis plug-in
therefore raised the Editor as well and tied native window lifetime and stacking
to an unrelated surface.

## Decision

Each plug-in instance has an independent top-level Electron BaseWindow. Opening
or reactivating it focuses that plug-in without showing or focusing the main
Editor. The toolbar remains a child of its own plug-in window, and the native
VST3/CLAP view remains embedded in that same plug-in host. There is no new process,
thread, renderer authority, or IPC contract.

AudioHostService owns editor lifetime by instance ID. Closing the main Editor
does not retire Analysis instances; removing a plug-in or closing Analysis still
closes its editor before unloading the instance. Runtime replacement, failure,
and application shutdown retain explicit editor cleanup. A late open completion
must not reactivate a closing or retired host.

## Alternatives rejected

Parenting editors to whichever application window requested them preserves the
same unwanted stacking and lifetime coupling. Making windows always on top would
also obstruct unrelated workflows. Independent top-level hosts satisfy the
requested multi-window workflow while retaining per-instance cleanup.

## Consequences

Plug-in windows can overlap or sit behind either application window according to
normal platform activation. They remain available when the main Editor is
minimized or closed, provided their owning instance and the application remain
alive. Application shutdown must continue to explicitly close all hosts rather
than relying on operating-system parent destruction.

## Verification

Unit tests cover the host/toolbar ownership boundary and delayed open/close
races. Electron integration tests exercise Analysis activation, main-window
minimize/close, multiple plug-in windows, reopening and instance cleanup. Native
platform hosts must continue to receive only the individual plug-in window's
handle. Platform CI and recorded native-window evidence define the tested scope;
mocked tests alone do not establish operating-system focus behavior.

## Reconsider when

A supported platform requires a different top-level presentation, or a future
document model gives plug-in windows an explicit user-visible docking policy.
