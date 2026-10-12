# MIDI control and observation

[ADR-0003](adr/0003-midi-control-and-observation.md) explains separate control
and observation paths. This document owns their current contract. Studio mappings
are application preferences; future Live bindings follow [Live documents](live-documents.md).

## Addresses and targets

Store one Studio binding per semantic target. A physical device ID, MIDI channel
and Note On/Control Change address may fan out to multiple targets without
consuming instrument or recording input. Disconnects retain bindings. Same-address
fan-out is informational, not a conflict. Missing targets are ignored without
retargeting or blocking siblings.

Mixer addresses index the shared visible Audio/Instrument/BUS/Master/Output order;
reordering intentionally changes their meaning. Gain, Pan, Mute and Solo are
supported; Mute/Solo select toggle or absolute zero/nonzero behavior. Plug-ins use
project-unique `controlAlias` plus stable parameter key. Names may repeat and
moving an instance preserves its alias. Current selection and project resource
IDs are not global control addresses.

## Delivery and persistence

The native MIDI actor copies control events into a bounded dispatch queue and
issues a coalesced nonblocking wake. Main decodes relative formats and applies
declarative transform profiles before fan-out. Continuous values coalesce to the
latest per binding; commands and toggles preserve order. Overflow is observable
and never backpressures MIDI/audio.

Absolute profiles cover all of `[0,1]` with linear, exponential, logarithmic,
S-curve or step segments. Relative profiles define base step and event-rate
acceleration. Profiles contain data, never executable formulas. Built-ins are
immutable and referenced user profiles cannot be deleted.

Hardware Mixer edits occupy a main-owned overlay; plug-in edits occupy runtime
state. They mark unsaved Studio state without adding Undo. Explicit mouse edits
win for the same field. Save captures the overlay and plug-in state in one worker
transaction; success clears it, failure leaves it dirty/retryable. Discard drops
it. Crash recovery does not promise unsaved gestures. Resource generation changes
invalidate parameter caches.

Learning opens all ports and suppresses ordinary mapping while retaining the
raw monitor. Otherwise open only ports referenced by bindings, input routes or
Clock. Send targets, takeover, Mackie/HUI, banks and hardware feedback remain
outside the implemented baseline.

## Active-note display

The MIDI actor owns counted notes keyed by port/channel/key. Main samples its
snapshot at 33 ms with one request in flight; that cadence never drives control
delivery. Note Off, velocity-zero Note On, all-notes-off, reset and disconnect
reconcile the map. Sustain does not extend Note On activity.

Renderer route filtering selects monitored/record-armed Instrument routes and
handles removal before deriving chords and key-signature spelling. Notes wholly
between snapshots may be invisible; the next snapshot recovers display gaps.
Chord recognition and formatting never run in the callback. Hardware/latency
and reconnect evidence belongs to [the performance baseline](product-live.md).
