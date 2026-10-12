# ADR-0035: Explicit mono and stereo output routes

- Status: Accepted
- Date: 2026-10-12
- Owners: project maintainers
- Scope: Studio and Live Mixer routing, persistence, native graph ABI and audio rendering

## Context

BUS channels are individual mono lanes. Main outputs and Sends previously stored
only one BUS number, and the mixer averaged left and right into that lane.
A stereo receiver reading BUS 1 and 2 could not receive both sides from one
route. Changing a receiver's input format cannot fix the sender's mapping.

## Decision

Each main output and Send owns an independent `mono` or `stereo` route format,
stored as `outputFormat` or `targetFormat`. The channel input format does not
choose the output format. Output, Add Send and Send destination controls share
a two-level menu: format first, then BUS or Output destination.

A mono BUS route writes `(L + R) / 2` into one numbered lane. A stereo BUS route
writes L to the selected lane and R to the next lane, without summing them.
Offer starts 1 through 255 for stereo and 1 through 256 for mono. Stereo pairs
may overlap; BUS lanes keep their existing identity. A mono route to an Output
averages L/R and feeds the result equally to its two sides. A stereo Output
route preserves L/R. The physical Output strip retains its hardware pair.
The established upstream mono pan law continues to apply.

Missing/null format retains the existing default: mono for BUS, stereo for
Output. This is also the representation restored when undoing the first format
edit on a route without an explicit format. This does not create a new archive
compatibility guarantee. New selections always supply a format.

A Send destination identity includes its format, allowing mono BUS 1 and stereo
BUS 1–2 on the same source. Duplicate routes with the same format are rejected.
Both lanes participate in cycle validation, target filtering, Solo, scheduling,
latency compensation, low-latency path planning and graph diagnostics, even
when only the right lane has a consumer.

The existing project command and revision contract owns mutations. Destination
and format commit together in the existing transaction; Undo restores both.
Invalid routes leave persisted state unchanged. Live routing remains Project
structure and stays locked during Perform. Native preparation resolves route
variants before publication; abort, reconciliation and quarantine retain the
existing graph deployment contract. Audio callbacks only mix into prepared
buffers and introduce no allocation, blocking or new process boundary.

## Persistence and migration generation

Studio and Live add nullable text columns with format and BUS-range checks.
Send unique indexes include the effective format with the same defaults as the
model. Both migrations are generated from Drizzle declarations.

The existing Studio snapshot 0007 still described plug-in columns superseded by
committed SQL migrations. To avoid reapplying those changes, migration 0009 was
generated against a temporary snapshot reconstructed from the preceding schema
declarations. Its new snapshot records the full current declarations and links
to 0007; existing migration SQL is unchanged. Live uses normal generation.
The resulting SQL changes only Mixer route columns, constraints and indexes.

## Alternatives rejected

- A menu-only change still mixes both sides into one BUS.
- Inferring send width from the source or receiver makes route identity depend
  on unrelated input/plugin edits and fails when consumers use different lanes.
- Creating two independent mono Sends loses stereo channel separation and
  requires two controls for a single intended send.

## Consequences

Route choices and duplicate checks distinguish width. A stereo pair ending
past BUS 256 is unavailable and invalid at the persistence and native boundaries.
The native ABI adds optional enum fields and generated TypeScript declarations.
No separate Send format command or intermediate format-only commit is needed.

## Verification

Model tests cover right-lane feedback filtering and format Undo. Presenter tests
cover menu grouping and emitted route intent. PGlite tests cover route format
persistence, invalid-pair rollback and Live archive reopening. DSP tests use
unequal, opposite-sign L/R samples to prove main and all Send taps preserve
stereo in frame and block processing, plus right-lane Solo and feedback checks.

## Reconsider when

Surround formats, nonadjacent output pairs, or independently addressable physical
mono Output strips require a general channel-map representation.
