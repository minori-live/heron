import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Wall-clock and compiler-cache timings for the CI check phases.
 *
 * GitHub Actions reports a single duration for the whole "Run repository
 * checks" step, which hides whether that time went into compiling, running
 * tests, or fetching and executing fixtures. Wrapping each phase produces the
 * breakdown, and the sccache counter delta distinguishes compilation from
 * execution: the hit+miss delta is the number of rustc invocations the phase
 * performed, so a slow phase with no invocations is test or fixture time.
 *
 * The diagnosis is deliberately outside the command path. The task shell runs
 * the phase itself and only asks this script to snapshot the compiler cache
 * before it and append the summary after it, so command quoting, PATH
 * resolution, and exit-status propagation stay exactly as they were. A timing
 * failure is reported on stderr and never changes the task result.
 */

const TABLE_SENTINEL = "<!-- heron-ci-timing -->"

const TABLE_HEADER = [
  TABLE_SENTINEL,
  "",
  "### Check phase timings",
  "",
  "| Phase | Wall clock | rustc invocations | Cache hits | Cache misses | Result |",
  "| --- | ---: | ---: | ---: | ---: | --- |"
].join("\n")

/** Counters shared by the sccache statistics and a phase delta. */
export interface CompilerCacheCounters {
  hits: number
  misses: number
  writes: number
}

export interface PhaseSnapshot {
  startedAt: number
  counters: CompilerCacheCounters | null
}

interface SccacheStatistics {
  stats: {
    cache_hits: { counts: Record<string, number> }
    cache_misses: { counts: Record<string, number> }
    cache_writes: number
  }
}

export function toCounters(statistics: SccacheStatistics): CompilerCacheCounters {
  const sum = (counts: Record<string, number>) =>
    Object.values(counts).reduce((total, count) => total + count, 0)
  return {
    hits: sum(statistics.stats.cache_hits.counts),
    misses: sum(statistics.stats.cache_misses.counts),
    writes: statistics.stats.cache_writes
  }
}

export function formatDuration(milliseconds: number): string {
  const tenths = Math.round(milliseconds / 100) / 10
  if (tenths < 60) {
    return `${tenths.toFixed(1)}s`
  }
  const totalSeconds = Math.round(tenths)
  const minutes = Math.floor(totalSeconds / 60)
  const remainder = totalSeconds % 60
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`
}

interface CacheDelta {
  invocations: number
  hits: number
  misses: number
}

function cacheDelta(before: CompilerCacheCounters, after: CompilerCacheCounters): CacheDelta {
  return {
    invocations: after.hits + after.misses - before.hits - before.misses,
    hits: after.hits - before.hits,
    misses: after.misses - before.misses
  }
}

export function renderRow(
  phase: string,
  milliseconds: number,
  before: CompilerCacheCounters | null,
  after: CompilerCacheCounters | null,
  status: number
): string {
  const duration = formatDuration(milliseconds)
  const result = status === 0 ? "ok" : `exit ${status}`
  if (before === null || after === null) {
    return `| \`${phase}\` | ${duration} | n/a | n/a | n/a | ${result} |`
  }
  const { invocations, hits, misses } = cacheDelta(before, after)
  return `| \`${phase}\` | ${duration} | ${invocations} | ${hits} | ${misses} | ${result} |`
}

/** Header plus row for the first phase, or only the row once the table exists. */
export function summaryChunk(existing: string, row: string): string {
  return existing.includes(TABLE_SENTINEL) ? `${row}\n` : `${TABLE_HEADER}\n${row}\n`
}

function readCounters(): CompilerCacheCounters | null {
  const binary = process.env.SCCACHE_PATH ?? "sccache"
  const result = spawnSync(binary, ["--show-stats", "--stats-format=json"], {
    encoding: "utf8"
  })
  if (result.error || result.status !== 0 || !result.stdout) {
    return null
  }
  try {
    return toCounters(JSON.parse(result.stdout) as SccacheStatistics)
  } catch {
    return null
  }
}

function describeCounters(
  before: CompilerCacheCounters | null,
  after: CompilerCacheCounters | null
): string {
  if (before === null || after === null) {
    return ""
  }
  const { invocations, hits, misses } = cacheDelta(before, after)
  return `, rustc ${invocations} invocations, hits +${hits}, misses +${misses}`
}

function appendSummary(row: string): void {
  const target = process.env.GITHUB_STEP_SUMMARY
  if (!target) {
    return
  }
  const existing = existsSync(target) ? readFileSync(target, "utf8") : ""
  appendFileSync(target, summaryChunk(existing, row))
}

function snapshot(): void {
  // Node owns the temporary path so the same process family resolves it on
  // every platform; a shell `mktemp` path is not portable to native Node on
  // Windows.
  const statePath = join(tmpdir(), `heron-ci-timing-${randomUUID()}.json`)
  const snapshotValue: PhaseSnapshot = { startedAt: Date.now(), counters: readCounters() }
  writeFileSync(statePath, JSON.stringify(snapshotValue))
  console.log(statePath)
}

function record(label: string, statePath: string, status: number): void {
  const snapshotValue = JSON.parse(readFileSync(statePath, "utf8")) as PhaseSnapshot
  const after = readCounters()
  const milliseconds = Date.now() - snapshotValue.startedAt

  console.log(
    `[ci-timing] ${label}: ${formatDuration(milliseconds)}${describeCounters(snapshotValue.counters, after)}`
  )
  appendSummary(renderRow(label, milliseconds, snapshotValue.counters, after, status))
  rmSync(statePath, { force: true })
}

function main(argv: string[]): void {
  const [command, ...rest] = argv
  try {
    if (command === "snapshot") {
      snapshot()
      return
    }
    if (command === "record" && rest[0] && rest[1]) {
      record(rest[0], rest[1], Number(rest[2] ?? "1"))
      return
    }
    console.error(
      "usage: node scripts/ci-timing.ts snapshot | record <label> <state-file> <status>"
    )
  } catch (error) {
    // Timing is diagnostic: a broken summary must not fail the check task.
    console.error(`[ci-timing] ignored timing error: ${String(error)}`)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
