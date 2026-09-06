# ADR-0002: Persist self-contained projects with canonical media

- Status: Accepted
- Date: 2026-09-06
- Owners: project maintainers
- Scope: current Studio persistence; Live lineage is defined in ADR-0004
- Related: [Database rules](../project-database.md), [Interaction design](../interaction-design.md), [Transactions](0001-runtime-ownership-and-transactions.md)

## Context

Projects need portable media, atomic edits, and recoverable working copies.
Running historical migrations on every new project adds latency, while external
media paths and repeated compressed decoding make playback and recovery fragile.
Audition also needs a lifetime independent of timeline playback and Undo.

## Decision

### Database, archives, and templates

PGlite and Drizzle own project persistence in a dedicated project worker. Main
uses named typed operations; neither renderer nor main receives a generic SQL
proxy. Drizzle schemas are structural truth, migrations are generated, and
multi-step invariants commit in worker-owned SQL transactions. Project commands
return snapshots decoded inside their transaction as specified in ADR-0001.

The main build atomically generates a gzip-compressed schema-only PGlite template
from committed migrations using the runtime migrator. Package both template and
migrations beside the worker. New projects load the template and seed configuration,
musical maps, default Mixer, metronome and plug-in state in one runtime transaction.
No project rows, placeholder identity, or build-host architecture enter the template.

Existing archives and recoverable working copies run the migrator. A missing or
invalid packaged template is an invariant violation; do not silently initialize
an empty database instead. Watch builds may reuse a template until inputs change.

Saved project archives are uncompressed PGlite data-directory dumps; the empty
build template is separately compressed. Projects own their media large objects.
Before saving, reclaim orphaned large objects and run maintenance outside the
callback as defined by the database rules. Supported migrations operate on working
copies, with source archives replaced only on save. Development formats have no
blanket compatibility guarantee; stability and future lineages follow ADR-0004.

### Media identity and placement

The right Media Browser owns the current project's audio and MIDI assets;
plug-in discovery belongs to the Mixer and the left panel to the contextual
Inspector. Notes and Media Browser share one mutually exclusive right panel.
Panel geometry and gestures live in the interaction specification.

WAV/BWF, MP3, and FLAC imports hash source bytes, decode off the callback, reject
non-mono/stereo layouts, and produce canonical float32 BWF plus waveform levels
before database import. Equal source hashes reuse the first asset ID and name.
MIDI retains original bytes and uses the same identity rule. Equal decoded PCM
from differently encoded source files does not imply the same asset.

Audio drops on an Audio lane create a clip; blank-space drops first create a
track. MIDI uses the mapping workflow with the targeted Instrument track or a
new track preselected. OS drops import before placement. Import, placement, and
mapping have distinct commit points: placement failure must retain and report a
successfully imported asset rather than claim the entire operation failed.

### Audition

One control-plane audition may coexist with transport playback. Main validates
the project asset, materializes its BWF, and routes to the graph's first stereo
Output. Preparation decodes and allocates off the callback. The callback swaps
owned buffers through the command ring, mixes directly into the selected hardware
outputs, and retires buffers through a bounded ring for control-thread destruction.

Audition does not move the playhead, alter playback/recording, create Undo,
persist state, or mark the document dirty. Replacement, explicit or bounded-duration
stop, and engine destruction release the audition's ownership.

## Alternatives rejected

- Runtime migrations for every new project make creation latency grow with history.
- Fully seeded build artifacts capture runtime-specific values; raw directory
  copying bypasses the existing archive boundary.
- External compressed files undermine self-contained projects and repeat decode work.
- Temporary timeline clips couple audition to transport and document editing.
- A global indexed sound library adds persistence and scanning obligations beyond
  the project-local workflow.

## Consequences

Decoded media consumes more archive space, while project playback uses canonical
assets. Template regeneration is a build responsibility and adds a packaged
artifact. Sharing core Mixer tables does not authorize copying tables or journals
between [Studio and Live documents](0004-layered-live-documents.md).

## Verification

Verify blank schema/template equivalence, seed atomicity, migration idempotency,
transaction snapshot rollback, archive save/reopen, media deduplication and byte
recovery, orphan cleanup, retained imports after placement failure, and audition
replacement/stop during playback. A production worker must create and reopen a
project from packaged template and migration resources.

## Reconsider when

PGlite changes its physical format, a portable logical snapshot is demonstrably
better, cross-encoding deduplication has measured value, or real workloads require
bounded streaming audition rather than in-memory buffers.
