# ADR-0009: Keep MIDI control event-driven and outside project history

- Status: Accepted
- Date: 2026-08-09
- Owners: project maintainers
- Related: `agents/docs/adr/0002-live-midi-control-addressing.md`, `agents/docs/roadmap.md`

## Context

The existing 100 ms MIDI snapshot serves device state, Clock, recording preview,
and low-frequency UI. Reusing it for live controls adds visible latency and makes
bursts depend on renderer scheduling. Hardware gestures also do not have a useful
project Undo boundary: one physical turn can produce hundreds of events while a
single address may fan out across several target categories.

## Decision

The native MIDI actor copies Note On and Control Change controls into a bounded
dispatch queue and issues a coalesced non-blocking wake. Electron main drains the
queue, decodes relative formats, evaluates declarative transform profiles, and
fans out bindings. Continuous values are latest-value coalesced per binding;
commands and toggles preserve order. The audio callback never calls N-API,
allocates for this path, blocks, or performs filesystem work.

Transform profiles are data, never executable formulae. Absolute profiles cover
all of `[0,1]` with linear, exponential, logarithmic, S-curve, or step segments.
Relative profiles define a base step and event-rate acceleration table. Built-in
profiles are immutable; referenced user profiles cannot be deleted.

Hardware Mixer changes live in a main-owned overlay. Plug-in changes live in the
host runtime. Neither creates project history. The effective graph is persisted
graph plus overlay. Saving captures plug-in state and commits it with the Mixer
overlay in one project-worker transaction; success clears the overlay, while
failure leaves it dirty and retryable. Discarding an open project drops the
overlay, and crash recovery does not promise unsaved hardware gestures.

Learning temporarily captures every port and suppresses normal mapping while
leaving the raw monitor active. Normal operation opens only ports referenced by
bindings, MIDI input routes, or Clock.

## Alternatives rejected

### Poll the existing snapshot faster

This still couples control latency to a timer and repeats work needed only by the
UI. It also obscures queue pressure and makes latency acceptance less meaningful.

### Put every hardware event in Undo history

The result has arbitrary gesture boundaries, very large histories, and surprising
fan-out semantics. Explicit mouse edits remain normal project commands and win
over an overlay for the same field.

### Execute user formulae

Formulae add a code-execution and portability surface. The visual segment and
acceleration editors cover the Current mapping requirements deterministically.

## Consequences

- Queue overflow is bounded and observable, never backpressure on MIDI or audio.
- Main owns target resolution and must invalidate plug-in parameter caches when
  resource generations change.
- High-frequency renderer snapshots remain presentation only.
- Soft takeover, Mackie/HUI, feedback, controller displays, and Send targets stay
  outside Current.

## Verification

Property tests cover every CC value, segment boundaries, invalid coverage, and
relative decoder tables. Runtime tests cover fan-out, ordering, coalescing,
learning suppression, missing targets, and overflow. Persistence tests cover
dirty-without-Undo, explicit-edit precedence, atomic save, retry, and discard.
Release evidence records native enqueue latency and real controllers on ASIO,
CoreAudio, and ALSA during the two-hour Live soak.

## Reconsider when

Reconsider the event model only if a future control-surface protocol supplies its
own transactional gesture and feedback semantics without entering the audio
callback.
