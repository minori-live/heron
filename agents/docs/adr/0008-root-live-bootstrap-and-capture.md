# ADR-0008: Bootstrap root Live performance with frozen selective Capture

- Status: Accepted
- Date: 2026-09-26
- Owners: project maintainers
- Related: [ADR-0004](0004-layered-live-documents.md),
  `agents/docs/roadmap.md`, `agents/docs/cross-process-error-contract.md`

## Context

ADR-0004 defines the eventual Project, Set, and Patch hierarchy. The first
usable `.hrl` needs a smaller root-only path that can be created, performed,
captured, saved, and recovered without introducing empty hierarchy records or
Studio timeline state. The existing Studio save path synchronizes every loaded
plug-in state, which would accidentally turn Perform adjustments into durable
edits. Replacing a running graph also needs an unambiguous native-instance and
failure policy.

## Decision

The bootstrap persists only Project-owned Mixer, plug-ins, device configuration,
MIDI bindings, and captured parameter values. Audio and Instrument Channels
exist directly in the Mixer. The default Audio Channel has monitoring off.
Edit mutations commit one revisioned Live transaction and enter undo history.
An audition build failure stops the audition and reports the failed state;
the document edit remains committed. A missing device or plug-in does not block
Edit or saving.

Perform may begin only after pending Edit plug-in state is synchronized and the
entire graph and exact audio device IDs pass preparation. Structure and device
configuration are locked while performing. Gain, Pan, Mute, Solo, Send level
and enabled state, plug-in enabled state, and plug-in parameters are volatile
runtime values. Save serializes the current document baseline and never samples
Perform state. Studio's save-time plug-in synchronization is not used for Live.

Capture freezes one runtime snapshot and its document revision. The preview
lists each changed Mixer field and each plug-in's complete opaque state and
individual parameters. The complete state is one indivisible choice; selected
parameters are independent persisted values, applied after opaque state when
the plug-in is restored. One selected Capture commits as a single undoable
transaction. Adjustments after the preview remain volatile. A failed Capture
does not change the running sound. A new preview is required after a successful
Capture. Remaining changes after a partial Capture still require an explicit
decision before exiting.

Leaving Perform, closing, or switching documents with volatile changes offers
Capture, discard, and cancel. Cancel preserves Perform. Discard rebuilds the
document baseline in a fresh candidate before switching to Edit. Ordinary
unsaved document edits receive their own save/discard/cancel decision. No
operation silently captures running state.

Stable document plug-in IDs map to generation-scoped native IDs. Baseline
restoration prepares all new plug-in instances, at most one candidate
deployment, and a complete graph. A failed preparation frees the candidate
and preserves the current performance. An unknown activation outcome is
reconciled through the graph transaction status before publishing the new
generation. Successful replacement invalidates old tokens and callbacks,
closes old editors, sends All Notes Off, and fades the outgoing and incoming
paths for bounded time; old instances are released only after the audio thread
has left the old graph. Old device-recovery attempts cannot overwrite a new
explicit device choice.

## Alternatives rejected

### A separate Live visual shell and channel inspector

Live retains Studio's topbar, bottom statusbar, and left/center/right workspace
grid. Root document navigation occupies the left column; the center is reserved
for a future custom performance surface. The existing Mixer moves into the
resizable right column. Shared strip, plug-in, routing, Send, and fader components
receive a Live controller through props and typed events; they do not import a
Studio document store. Device/MIDI setup opens in the existing dialog and settings
primitives. A second set of channel controls and a separate channel inspector
would duplicate gestures and break the application's spatial grammar.

Workspace chrome, control groups, Master controls, statusbar, and side-panel
resizing have shared implementations under `components/workspace`. Document
adapters supply state and handle typed intent; they do not copy presenter markup
or gesture logic. File operations remain in the existing application menu and
shortcuts, without separate Live load/save buttons.

### Persist Perform controls on Save

This would make Save a hidden full Capture and make selective Capture
impossible to reason about.

### Restore the baseline into the same native plug-in instances

An opaque restore may fail after mutating a live processor. Fresh instances
provide a candidate that can be discarded without changing the current sound.

### Add placeholder Set and Patch records now

Empty hierarchy records would complicate ownership and migration before the
first root performance flow is usable. The root-only format can be extended by
a later Live migration without changing its bootstrap semantics.

## Consequences

The Live document needs a distinct save path, temporary runtime state, and a
generation map for native instances. Plug-in restoration must apply opaque
state before captured parameter values. Graph replacement is more expensive
than same-instance reset, so candidate lifetime and cleanup must be bounded.
The Set/Patch layer and Studio import remain separate delivery stages.

## Verification

Tests must cover baseline-only Save, edit undo, frozen and partial Capture,
concurrent adjustments, cancellation, revision conflicts, candidate cleanup,
unknown native commit reconciliation, stale event rejection, exact device
identity, and repeated entry/exit without retained notes or instances. Manual
hardware evidence remains required on Windows ASIO, macOS CoreAudio, and Linux
ALSA, including a two-hour performance on each platform.

## Reconsider when

A bounded in-place plug-in restore API can prove that failure cannot affect the
running graph, or measured full-instance rebuild costs make the bootstrap
transition unusable on supported hardware.
