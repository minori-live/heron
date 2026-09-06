# ADR-0003: Separate MIDI control delivery from state observation

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Scope: current Studio mappings and shared MIDI delivery; Live ownership differs under ADR-0004
- Related: [Live performance contract](../product-live.md), [Runtime ownership](0001-runtime-ownership-and-transactions.md)

## Context

Hardware mappings must survive project changes and disconnects without persisting
project resource IDs in global preferences. Controls need prompt bounded delivery;
the chord display needs a recoverable view of active notes, not every transient event.
Neither physical gestures nor chord naming belongs in the audio callback or in
one project-history entry per MIDI event.

## Decision

### Addressing

Studio application preferences store one binding per semantic target. A physical
device ID and MIDI message address may fan out independently to several application,
Mixer, and plug-in targets without consuming instrument or recording input.

Mixer targets index the shared visible order of Audio, Instrument, BUS, Master,
and Output channels. Reordering intentionally changes the target. Gain, Pan,
Mute and Solo are supported; Mute/Solo choose toggle or absolute behavior. Plug-in
targets use a project-unique `controlAlias` and stable parameter key; display names
may repeat and moving an instance preserves its alias. Missing indices or aliases
ignore input without retargeting or blocking siblings. Disconnects retain bindings
by device ID. Same-address fan-out is an informational warning, not a conflict.

### Event-driven controls and persistence

The native MIDI actor copies Note On and Control Change into a bounded dispatch
queue and issues a coalesced non-blocking wake. Main drains, decodes relative
formats, applies declarative transform profiles, and fans out bindings. Continuous
values coalesce to the latest per binding; commands and toggles preserve order.
Overflow is observable and never backpressures MIDI or audio.

Absolute profiles cover all of `[0,1]` through linear, exponential, logarithmic,
S-curve or step segments. Relative profiles specify base step and event-rate
acceleration. Profiles are data, not executable formulas; built-ins are immutable
and referenced user profiles cannot be deleted.

Hardware Mixer changes occupy a main-owned overlay; plug-in changes occupy runtime
state. They mark unsaved Studio state without creating Undo. Explicit mouse edits
win for the same field. Save captures plug-in state and the Mixer overlay in one
worker transaction: success clears the overlay, failure leaves it dirty and
retryable. Discard drops it; crash recovery does not promise unsaved gestures.
Invalidate parameter caches when resource generations change.

Learning captures all ports and suppresses ordinary mapping while leaving the raw
monitor active. Otherwise open only ports referenced by bindings, input routes, or
Clock. Send targets, soft takeover, Mackie/HUI, banks, and hardware feedback are
outside this decision's implemented scope. Live document-owned bindings and
volatile Perform Mode values follow ADR-0004 rather than Studio save semantics.

### Active-note observation

The MIDI actor owns a counted active-note map keyed by port, channel and key.
Its typed runtime snapshot publishes active notes; main samples at 33 ms with
one request in flight. This presentation path does not drive control dispatch.

Note Off, velocity-zero Note On, all-notes-off, reset and disconnect reconcile
actor state. The renderer filters monitored/record-armed Instrument routes,
reconciles route removal, then derives chords and key-signature spelling. Sustain
does not extend Note On activity. Notes wholly between snapshots may be invisible,
which is acceptable for a current-state display. The latest snapshot recovers gaps.

## Alternatives rejected

- Global project IDs, current selection, and silent retargeting create unstable
  hardware meanings; stable slots/banks would introduce another assignment model.
- Faster snapshot polling still couples control delivery to a timer.
- Every hardware event in Undo creates arbitrary gesture boundaries and huge histories.
- User formulas add execution risk without a current requirement.
- Shortcut event windows omit Note Off; streaming every display event adds replay
  machinery; callback chord naming mixes UI and real-time ownership.

## Consequences

Visible reordering deliberately retargets Studio Mixer bindings. Device identity
remains explicit. Display cadence and low-latency control delivery have separate
purposes and validation budgets.

## Verification

Cover fan-out, missing targets, alias moves, reconnects, relative encodings, all CC
values and profile boundaries, coalescing/order, overflow, learning, explicit-edit
precedence, atomic save/retry/discard, note lifecycle and route filtering. Validate
real controllers and enqueue latency on supported audio backends during release soaks.

## Reconsider when

Banked surfaces, takeover or feedback require different gesture semantics, or
measured observation overhead or loss of short notes requires an ordered display stream.
