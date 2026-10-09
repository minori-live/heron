import assert from "node:assert/strict"
import test from "node:test"
import {
  formatDuration,
  renderRow,
  summaryChunk,
  toCounters,
  type CompilerCacheCounters
} from "./ci-timing.ts"

await test("sums sccache counters across languages", () => {
  assert.deepEqual(
    toCounters({
      stats: {
        cache_hits: { counts: { Rust: 157, "C/C++": 1 } },
        cache_misses: { counts: { Rust: 873, "C/C++": 4 } },
        cache_writes: 42
      }
    }),
    { hits: 158, misses: 877, writes: 42 }
  )
})

await test("formats sub-minute and multi-minute durations", () => {
  assert.equal(formatDuration(9_600), "9.6s")
  assert.equal(formatDuration(59_940), "59.9s")
  assert.equal(formatDuration(59_960), "1m 00s")
  assert.equal(formatDuration(60_000), "1m 00s")
  assert.equal(formatDuration(312_000), "5m 12s")
  assert.equal(formatDuration(7_560_000), "126m 00s")
})

await test("renders a row with per-phase compiler cache deltas", () => {
  const before: CompilerCacheCounters = { hits: 100, misses: 900, writes: 0 }
  const after: CompilerCacheCounters = { hits: 350, misses: 950, writes: 5 }
  assert.equal(
    renderRow("check:static", 312_000, before, after, 0),
    "| `check:static` | 5m 12s | 300 | 250 | 50 | ok |"
  )
})

await test("renders unavailable counters without inventing a delta", () => {
  assert.equal(
    renderRow("check:design", 12_300, null, null, 1),
    "| `check:design` | 12.3s | n/a | n/a | n/a | exit 1 |"
  )
})

await test("writes the table header once per step summary", () => {
  const first = summaryChunk("", "| row |")
  assert.match(first, /<!-- heron-ci-timing -->/u)
  assert.match(first, /### Check phase timings/u)
  assert.match(first, /\| row \|\n$/u)

  const second = summaryChunk(first, "| second |")
  assert.doesNotMatch(second, /### Check phase timings/u)
  assert.equal(second, "| second |\n")
})
