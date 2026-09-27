# PGlite performance audit

Date: 2026-09-27. Audited revision: `afa7c01`.

Status: baseline audit with implementation follow-up. The numbered findings below
describe `afa7c01`; the follow-up section records the resulting changes and their
verification. The evidence supports fixing Heron's data access and serialization
before considering another database.

## Baseline measurement scope

- Windows, AMD Ryzen 9 5950X, repository-managed Node 26.8.2 and pnpm 12.4.1.
- PGlite 0.5.8 / PostgreSQL 18.3 (WASM), Drizzle 0.45.2.
- Workloads ran sequentially, without another audit benchmark running concurrently.
- Integration fixtures use the system temporary directory on C:. The lifecycle
  and workload probes use `test-results/pglite-audit` on E:. Do not extrapolate
  the E: startup timings directly to the C: suite or CI. Disk startup samples ran
  before memory samples, rather than in randomized order.
- Tables below report medians of three samples, except project operations (five),
  the integration suite (one), and explicitly identified one-off observations.
- These are database API and codec measurements. They exclude Electron IPC,
  renderer rendering, native graph publication, plug-in state capture, and audio
  decoding. No competing DAW or native PostgreSQL server was benchmarked.
- The baseline did not change application implementation, schema, durability
  settings, or dependencies. Buffer codecs were enabled only inside an isolated
  experiment.

Raw measurements, logs, source probes, and the installed dependency source excerpt
are retained locally under `test-results/pglite-audit/` (Git-ignored). They are
generated evidence, not public documentation assets.

## 1. Small edits reread and copy the entire project

The worker's `prepare-project-command` calls `mixerSnapshot()` before applying a
command to the candidate graph (`apps/desktop/src/main/project/project-worker.ts:100`).
Commit calls `ProjectDatabase.applyCommand()` and reads another complete snapshot
inside the SQL transaction (`packages/project-db/src/node.ts:389`).

Each snapshot executes nine project queries plus five mixer queries. It reads all
MIDI notes/events and all plug-in state chunks, even when only one channel name or
gain changed. See `internal/project-reads.ts:33` and `internal/mixer-reads.ts:18`.
Thus a normal prepare/commit pair has at least 28 snapshot SELECTs, in addition to
validation and mutation queries. `Promise.all` does not parallelize PostgreSQL
execution within PGlite's single connection.

| Database API operation                                   | 68 channels, no notes | +32,000 notes | +8 MiB plug-in state |
| -------------------------------------------------------- | --------------------: | ------------: | -------------------: |
| Single-row update in a Drizzle transaction, no snapshot  |               1.54 ms |       1.63 ms |              1.51 ms |
| One full snapshot                                        |               9.54 ms |     342.49 ms |          1,086.07 ms |
| `applyCommand` channel rename, including commit snapshot |              10.65 ms |     339.93 ms |          1,099.33 ms |
| One `structuredClone` of the snapshot                    |               0.37 ms |      26.75 ms |             31.10 ms |

The raw update is a diagnostic control, not a semantically complete substitute for
the command protocol. The measured `applyCommand` excludes the preparation
snapshot; the user-facing command pays that additional read and multiple copies.
The full command latency was not measured and must not be presented as the sum of
these isolated medians.

For `SELECT * FROM midi_notes ORDER BY clip_id, start_tick, id`, the two warm
`EXPLAIN (ANALYZE, BUFFERS)` samples reported 40.83–43.94 ms execution, while full
JavaScript results took 323.44–339.60 ms. Warm plans had zero shared-buffer reads
and an in-memory 2,512 KiB quicksort. The gap includes result serialization,
protocol processing, and JS materialization; it is not solely disk I/O or solely
Drizzle overhead. EXPLAIN does not send the 32,000 result rows to the client.

Copies occur in the worker's retained prepare/commit results, main's response,
`applyToGraph`, and renderer graph replacement. The binary plug-in state should
not accompany every UI/control graph response indefinitely.

Optimization direction: separate control/arrangement data from plug-in state;
reuse revision-bound state or return affected data with a validated commit result.
Preserve the existing rule that snapshot/decoding failure rolls back a mutation,
along with prepared-token, reconciliation, acknowledgement, and retry semantics.
Changes to that protocol need an ADR and failure-path tests.

Excluded false positives: fader preview is separate from commit and already
coalesced. Not every pointer move writes the database. Main graph reads normally
use a cache; not every renderer graph request queries PGlite.

## 2. Default bytea codecs dominate media transfer

The installed PGlite 0.5.8 source map contains `src/types.ts:158–177`:
bytea writes use `Array.from(bytes).map(...toString(16)...).join('')`; reads use
per-byte `parseInt` through `Uint8Array.from`. Heron sends audio large objects,
plug-in state, MIDI source bytes, and waveforms through this path.

An isolated A/B experiment kept the same bytea hex representation but used
Node Buffer hex encoding/decoding via PGlite's serializers/parsers. Every result
was checked byte-for-byte, including a Uint8Array view with a nonzero offset.
Default/Buffer order alternated between iterations.

| Operation                     | Default codec | Buffer hex codec |  Ratio |
| ----------------------------- | ------------: | ---------------: | -----: |
| Encode 1 MiB to hex           |     107.14 ms |          0.39 ms |  ~278× |
| Decode 1 MiB from hex         |      86.24 ms |          1.11 ms |   ~78× |
| SQL round-trip of 1 MiB bytea |     225.82 ms |         21.16 ms | ~10.7× |
| Import 8 MiB large object     |   1,177.34 ms |        271.57 ms |  ~4.3× |
| Read 8 MiB large object       |     738.24 ms |         40.81 ms | ~18.1× |
| Import 16 MiB large object    |   2,354.96 ms |        560.19 ms |  ~4.2× |
| Read 16 MiB large object      |   1,450.12 ms |         84.75 ms | ~17.1× |

This is a practical first optimization candidate without changing archive format
or replacing PostgreSQL. It still uses hex on the wire and does not remove
whole-object reads, copies, or worker queue blocking. A production wrapper needs
input/type/offset validation and focused round-trip/rollback coverage. This audit
does not claim that the experimental wrapper is already integrated or validated
across every binary path.

Do not advertise binary result transport as a supported drop-in alternative:
the installed public serializer type returns `string`, and query options do not
expose a binary result mode.

## 3. MIDI mutations need bounded, set-based work

`internal/midi-persistence.ts:153` awaits one UPDATE per changed note. Rebase also
reads all clip notes/events and individually updates them.

Updating the same velocity on 1,000 notes took 454.75 ms using the existing
per-note persistence function, versus 10.37 ms with one equivalent Drizzle
set-based UPDATE. Both ran within a transaction and excluded snapshot creation.
This establishes the gain for a common-patch operation; arbitrary distinct note
patches require a different bounded batching design.

There is also a confirmed correctness defect: initial inserts are batched without
a parameter cap (`midi-persistence.ts:57` and `:130`). A clip with 8,192 notes uses
65,536 bind parameters. The probe failed with code `08P01`:

> bind message supplies 0 parameters, but prepared statement "" requires 65536

The source, clip, and notes all rolled back, which the probe verified. Chunk these
inserts under the protocol limit inside the same transaction; do not split the
atomic import into separate commits. MIDI event inserts and large IN lists merit
the same bounds review. Their exact failure boundaries were not measured here.

## 4. Asset listing retrieves unrelated complete MIDI files

`ProjectDatabase.listAssets()` selects every MIDI source's `rawBytes` only to
calculate `byteLength` (`node.ts:357–372`). Listing one synthetic 8 MiB MIDI source
and audio metadata took 972.41 ms. A MIDI metadata-only SELECT took 1.03 ms.
The latter is a diagnostic control and omits the audio query and byte-length
calculation; it is not an implemented equivalent replacement.

`AudioImportService` calls this full listing for each imported file before finding
a duplicate hash in JS (`audio-import-service.ts:54`). Importing several files
therefore repeatedly transfers all unrelated MIDI source bytes. The repository's
large-object import already performs an indexed duplicate check transactionally.

Use named hash lookups or a scoped deduplication map, and obtain byte length
without materializing the payload. If adding stored length, generate the migration;
if using a SQL expression, deliberately reconcile the current raw SQL policy.

## 5. Integration tests repeatedly pay physical database lifecycle costs

The unmodified integration suite passed 55 tests with 5 skipped, in approximately
86.68 seconds from the JSON report. Studio's reported file interval was 42.07 s;
Live's was 27.80 s. These intervals do not account for all setup/runner time.

Static construction count across active tests:

| Tests                               | Active cases | PGlite constructions, including templates |
| ----------------------------------- | -----------: | ----------------------------------------: |
| Studio                              |           19 |                                        25 |
| Live                                |            7 |                                        18 |
| Pure, mock, and architecture checks |           29 |                                         0 |
| Total                               |           55 |                                        43 |

Studio's fixture creates a physical database from the template for almost every
case, then closes it and recursively deletes its directory. Tests already share
templates within each file; they do **not** run every migration for every case.
There are three template builds across the two files, including the cross-lineage
test. Desktop worker unit tests mock the DB, so they do not add another real
PGlite fixture suite.

| Lifecycle probe                  |      Median | Observed range |
| -------------------------------- | ----------: | -------------: |
| E: disk template create + seed   | 3,928.44 ms | 3,917–4,182 ms |
| In-memory template create + seed |   354.02 ms |     340–363 ms |
| Disk close                       |   216.83 ms |     193–264 ms |
| Memory close                     |     1.28 ms |   1.15–1.29 ms |

One-off observations: build schema template 3.77 s; blank in-memory initdb
0.98 s; in-memory migration 0.098 s. The disk/memory startup comparison supports
changing fixture arrangement, not a prediction of an 11× suite speedup.

Use real in-memory PGlite or a carefully reset reusable fixture for transaction,
constraint, mapping, and rollback tests. Keep independent physical instances for
disk reopening, archives, migration/lineage, isolation, and durability boundaries.
Share template preparation where possible. Do not replace these owned persistence
tests with mocks or enable all-file parallelism without measuring CPU/memory use.

## 6. Existing benchmark is broken and misses the costly paths

`pnpm --filter @heron/project-db bench` failed during setup with SQLSTATE `23503`,
`midi_clips_track_id_tracks_id_fk`. Its fixture creates mixer channels but no
tracks, then uses channel IDs as clip track IDs (`pglite.bench.ts:51–89`).
Its percentile output is consequently `NaN`.

Even after repairing that fixture, its "initial graph load" is a warmed snapshot
read (five samples), not project opening. The "ten-minute audio" file is empty;
only waveform data is populated. Add explicit coverage for create/open/save,
small commands at several project sizes, plug-in state payload size, note updates,
and real media import/export. Keep warm read benchmarks but label them accurately.

## 7. Media and archive architecture adds further full-volume work

- Audio import converts to a temporary BWF, writes it into a large object, then
  removes the temporary. Graph publication may immediately read the entire
  object back through `lo_get`, clone it from worker to main, and write a cache
  file. Cache hits avoid that media read. Reusing the validated import file or
  exporting directly inside the worker can eliminate copies on cache misses.
- Saves scan LO references/catalog, unlink orphans, run `VACUUM (ANALYZE)`, dump
  the entire physical database, materialize its archive as an ArrayBuffer, and
  write/fsync it. Open reads the complete archive into a Blob before restoration.
- The workload with 32k notes, 8 MiB state, 8 MiB MIDI source, and 16 MiB audio
  produced approximately 131.85 MiB archives. A standalone post-workload VACUUM
  took 630 ms once; subsequent `dumpTo` calls took 906 and 817 ms; reopening took
  5.20 s once. The prior VACUUM means the save times are **not** representative
  first-save timings, nor can they attribute all save cost to VACUUM.
- Every worker request except cancellation enters one serial queue. Large media
  reads/imports, archive dumps, and background waveform jobs can delay later
  interactive requests. Queue wait time was not instrumented in this audit.

Changing persistence layout or maintenance policy needs an ADR and recovery tests.
These are measured or source-confirmed architectural costs, not evidence that
every save must use a different format.

## Baseline recommendations

1. Repair the benchmark fixture and add phase/size measurements. Cap MIDI insert
   parameters while preserving import atomicity.
2. Integrate and validate Node bytea codecs; remove binary payloads from asset
   listing; batch common MIDI edits. These offer localized, demonstrated gains.
3. Reduce full-project reads and state payloads in the command protocol while
   retaining commit/rollback and delivery-reconciliation guarantees.
4. Optimize real PGlite test fixture lifetimes and keep explicit disk cases.
5. Instrument actual worker queue waits, save phases, and media cache misses;
   then decide whether a persistence/IPC architecture change is justified.

Do not begin by changing `relaxedDurability`. The installed NodeFS inherits a
no-op `syncToFs`, and the running database reports `fsync=off` from PGlite's
startup defaults. It is incorrect to attribute every SELECT here to an awaited
disk fsync. Final archive writes still explicitly sync their file handle.

The implementation already has transactional LO imports, 1 MiB input chunks,
batched initial MIDI inserts, relevant uniqueness/range indexes, and SQL-windowed
waveform reads. Missing transactions or a blanket lack of indexes are not the
root findings.

## Implementation follow-up

[ADR-0009](adr/0009-pglite-data-transfer-and-read-reuse.md) records the chosen
boundaries. The changes keep worker ownership, Drizzle transactions, project
format, and command delivery reconciliation:

- Audio LO transfers use unique PGlite virtual files outside PGDATA, raw bytes,
  and parameterized `pg_read_binary_file`/`lo_export`. Audio no longer traverses
  bytea text codecs. One MiB import chunks remain inside one asset transaction;
  the real-engine tests disable bytea codecs while checking byte equality,
  subviews, empty objects, failure cleanup, and rollback.
- Remaining bytea columns use native Buffer encoding/decoding with malformed
  input checks and Uint8Array return values. This is a fallback text path, not
  a claim that every binary column now uses binary protocol.
- Successful snapshots retain immutable MIDI and plug-in payload rows. Metadata
  and descriptor decoding still happen inside the command transaction. MIDI
  edits reload affected clips; cascades invalidate all affected payloads. Reads,
  mutations, archive saves, and close serialize around cache publication;
  failed transactions cannot publish tentative rows. Returned arrays are isolated.
- MIDI writes use bounded parameter batches, adjacent equal patches become set
  updates, and rebasing uses SQL arithmetic. Tests exercise more than 65,535
  parameters, later-batch failures, repeated IDs, and intermediate constraint
  violations without partial persistence.
- Asset summaries compute MIDI length in SQL, import deduplication performs a
  targeted hash lookup, and successful audio import seeds the materializer from
  its existing BWF. A cache failure cannot change a known database commit.
- Ordinary transaction fixtures use separate memory databases. Disk/archive
  coverage remains. The repaired benchmark checks its populated fixture and
  measures lifecycle, editing, metadata, waveform, and real audio operations.
- Archive write streams the PGlite Blob and open uses a file-backed Blob, removing
  extra archive-sized JavaScript copies while keeping durability operations.

Rerunning the same isolated lifecycle/project probe on the same E: volume produced
the following results. Medians use the same sample counts as the baseline;
single LO samples are labelled and are not statistical speedup estimates.

| Database API operation                                        |    Baseline | Follow-up |
| ------------------------------------------------------------- | ----------: | --------: |
| Rename, 68 channels and 32k notes (n=5)                       |   339.93 ms |  10.69 ms |
| Rename, additionally 8 MiB plug-in state (n=5)                | 1,099.33 ms |  12.10 ms |
| Update 1,000 note velocities, mutation transaction only (n=3) |   454.75 ms |  18.80 ms |
| List assets with an 8 MiB MIDI source (n=3)                   |   972.41 ms |   1.35 ms |
| Import 16 MiB LO (n=1)                                        | 3,040.75 ms | 233.16 ms |
| Read 16 MiB LO (n=1)                                          | 1,779.54 ms |  60.72 ms |

The mutation-only MIDI row excludes a committed snapshot. The maintained
benchmark also measures the complete public MIDI command and checks the
8192-note import/undo path that previously exceeded the bind limit.

The final maintained benchmark ran on the C: system temporary directory after
the full check had finished. Its warm fixture contains 68 channels, 32k notes,
8 MiB plug-in state, 8 MiB MIDI source bytes, and 16 MiB audio. Do not compare its
disk lifecycle times with the E: lifecycle probe above.

| Maintained benchmark                                 | Samples |         p50 |         p95 |
| ---------------------------------------------------- | ------: | ----------: | ----------: |
| New disk document, including close                   |       3 | 1,455.86 ms | 1,464.92 ms |
| Restore populated archive, including close           |       3 | 1,859.81 ms | 1,879.35 ms |
| Save populated project archive                       |       3 |   720.81 ms |   723.19 ms |
| Warm full project snapshot                           |       5 |    11.99 ms |    13.60 ms |
| Rename with committed snapshot                       |       5 |    15.66 ms |    18.45 ms |
| Update 1,000 note velocities with committed snapshot |       5 |    43.67 ms |    61.16 ms |
| Asset metadata                                       |       5 |     1.07 ms |     2.77 ms |
| Windowed waveform read                               |      20 |     0.97 ms |     1.24 ms |
| Read 16 MiB audio LO                                 |       3 |    56.83 ms |    58.66 ms |
| Import and undo an 8192-note clip                    |       3 |   605.29 ms |   630.01 ms |
| Import and delete 16 MiB audio LO                    |       3 |   253.70 ms |   258.06 ms |

These small sample counts describe a bounded local probe, not tail-latency
guarantees. The first implementation invalidated all MIDI rows on a note edit and
measured 347.05 ms for the full 1,000-note command; clip-scoped refresh reduced
that to 43.67 ms in the same maintained workload.

Validation: `mise run check` passed the full Windows path, including the standard
ASIO-enabled native build, Rust tests/Clippy/benchmark compilation, lint and types,
1,547 desktop unit tests, 77 Storybook tests, and 25 Playwright tests. The separate
Electron main build verified both built workers' template round-trips. The final
isolated database suite passed **75 tests with 5 pre-existing skips in 61.96 s**,
versus 55 passes and 5 skips in 86.68 s at baseline. Each suite timing is one run;
disk/archive coverage remains and new rollback/cache/binary cases account for
the additional tests.

Physical startup remains a material cost: E: disk creation was about 3.98 s and
populated archive open about 5.24 s in the follow-up. The archive is still about
132 MiB, and one structured clone of the populated graph still takes about 31 ms.
The changes therefore do not establish an Electron end-to-end latency or a DAW
comparison. Full graph IPC copies, worker queue waits, full-volume LO reads, and
PGlite's own archive materialization remain performance boundaries. Changing
those requires separate measurements and compatibility decisions.

## Reproduction and evidence

Normal suite: `pnpm --filter @heron/project-db test:integration`.
Maintained benchmark: `pnpm --filter @heron/project-db bench` (the baseline
version failed during fixture setup; the follow-up fixes it).

The two isolated source probes are archived as
`test-results/pglite-audit/pglite-audit.test.ts` and
`test-results/pglite-audit/pglite-codec-audit.test.ts`. To reproduce, temporarily
copy them into `packages/project-db/src/__benchmarks__/`, run each exact test path
using `pnpm --filter @heron/project-db exec vitest run`, then remove those copies.
Run the lifecycle probe first to create the schema template. The optional
`node test-results/pglite-audit/query-plan.ts` probe expects its populated working
database to remain available. Probe databases and synthetic media from this audit
remain in that local directory. No application or user project data was targeted.

Evidence files: `integration.json`, `measurements.json`, `codec-measurements.json`,
`query-plan.json`, `existing-bench.log`, and the probe logs in the same local
directory. Synthetic media bytes are random; shapes and byte sizes are fixed.
There are no latency assertions and no claimed full Electron/UI performance pass.
Follow-up evidence is in `after/measurements.json`, `final-integration.json`,
`final-bench.log`, `full-check.log`, and `main-build.log`. The maintained benchmark
uses seeded bytes and can be rerun without those local audit artifacts.

Primary background sources, checked during the audit:

- [PGlite overview](https://pglite.dev/docs/about): WASM PostgreSQL runtime.
- [Getting started](https://pglite.dev/docs/): single exclusive connection.
- [Filesystems](https://pglite.dev/docs/filesystems): native NodeFS versus memory.
- [Prepopulated filesystem](https://pglite.dev/docs/prepopulatedfs): avoiding
  repeated initdb work using an archive.
- Exact codec/NodeFS behavior above was checked against the installed **0.5.8**
  package source maps, rather than assuming upstream main matches the lockfile.
