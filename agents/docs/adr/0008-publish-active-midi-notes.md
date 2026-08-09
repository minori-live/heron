# ADR-0008: Publish active MIDI notes in runtime snapshots

- Status: Accepted
- Date: 2026-08-09
- Owners: project maintainers
- Related: real-time MIDI chord display

## Context

The studio control bar needs a Logic-style chord label derived from MIDI notes whose Note On
lifecycle is still active. The existing control-event window records only shortcut-learning Note
On and control-change messages, so it cannot reconcile Note Off, device disconnects, or runtime
snapshot gaps. Renderer code also must not read the native add-on or enter the audio callback.

## Decision

The MIDI input actor owns a counted active-note map keyed by input port, channel, and key. Its
existing typed runtime snapshot publishes a backward-compatible `active_notes` field. Electron
main polls that snapshot every 33 ms using the existing single-in-flight guard and forwards it
through the MIDI runtime resource.

The renderer filters the snapshot against monitored or record-armed instrument routes before
recognizing a chord. Recognition and key-signature spelling remain pure renderer derivations. Note
Off, velocity-zero Note On, channel all-notes-off, system reset, route removal, and disconnect
reconcile the actor-owned state. Sustain controllers do not extend the activity lifetime.

## Alternatives rejected

### Reuse shortcut control events

The window excludes Note Off and is enabled according to shortcut preferences, so it cannot be an
authoritative active-note source.

### Push every MIDI event to the renderer

An event stream would require new bounded delivery, gap recovery, and replay semantics for state
that already fits in a small snapshot. It would also broaden a high-frequency boundary without a
measured need.

### Recognize chords in the audio callback

Chord naming is UI work and depends on project key-signature context. Keeping it out of the callback
preserves the real-time boundary.

## Consequences

The actor remains the single owner of live input lifecycle state, and renderer recovery needs only
the latest snapshot. Snapshot traffic rises from 10 Hz to about 30 Hz. Notes pressed and released
entirely between two snapshots can remain invisible, which is acceptable for a current-state
display.

## Verification

Rust tests cover counted note lifecycle and reset behavior. Wire, store, route-filter, chord
recognition, publisher cadence, and Vue component tests cover the remaining boundary and display.

## Reconsider when

Replace this decision if measured polling overhead is material, if MIDI activity must display every
short event, or if another feature requires a general ordered MIDI observation stream.
