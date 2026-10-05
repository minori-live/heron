import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { isDeepStrictEqual } from "node:util"
import type { PluginAnalysisReport } from "../src/main/audio-host/wire/generated/PluginAnalysisReport.ts"

// Compare saved profiles and their complete reports; this runs no timed workload.
// node apps/desktop/scripts/plugin-analysis-compare.ts before.json after.json comparison.json
interface Run {
  scenario: string
  mode: string
  speed: string
  iteration: number
  settings: unknown
  analysisWallMs: number
  lifecycleWithoutRepeatedQueriesMs: number
  reportPath: string
  evidence: { workload: unknown; numericalSha256: string; sectionDigests: Record<string, string> }
}
interface Profile {
  metadata: {
    label: string
    buildProfile: string
    node: string
    fixture: unknown
    fixtureId: string | null
    fixtureFormat: string
    pollMs: number
    parameterQueries: number
    runtime: unknown
    addon: unknown
  }
  results: Run[]
}

const [beforeFile, afterFile, outputFile] = process.argv.slice(2)
assert.ok(beforeFile && afterFile && outputFile, "Supply before, after, and output JSON paths")
const before = JSON.parse(await readFile(beforeFile, "utf8")) as Profile
const after = JSON.parse(await readFile(afterFile, "utf8")) as Profile
for (const key of [
  "buildProfile",
  "node",
  "fixture",
  "fixtureId",
  "fixtureFormat",
  "pollMs",
  "parameterQueries",
  "runtime"
] as const) {
  assert.notEqual(before.metadata[key], undefined, `Missing baseline metadata: ${key}`)
  assert.deepEqual(before.metadata[key], after.metadata[key], `Matched metadata: ${key}`)
}

const identity = (run: Run) => JSON.stringify([run.scenario, run.mode, run.speed])
const pairIdentity = (run: Run) =>
  JSON.stringify([run.scenario, run.mode, run.speed, run.iteration])
const caseLabel = (run: Run) => `${run.scenario}-${run.mode}-${run.speed}`
function indexRuns(profile: Profile): Map<string, Run> {
  assert.ok(Array.isArray(profile.results) && profile.results.length > 0, "Profile has no runs")
  const indexed = new Map<string, Run>()
  for (const run of profile.results) {
    assert.ok(
      [run.scenario, run.mode, run.speed, run.reportPath].every(
        (value) => typeof value === "string" && value.length > 0
      )
    )
    assert.ok(Number.isSafeInteger(run.iteration) && run.iteration >= 0, "Invalid run iteration")
    assert.ok(
      Number.isFinite(run.analysisWallMs) && run.analysisWallMs > 0,
      "Invalid analysis timing"
    )
    assert.ok(
      Number.isFinite(run.lifecycleWithoutRepeatedQueriesMs) &&
        run.lifecycleWithoutRepeatedQueriesMs >= 0,
      "Invalid lifecycle timing"
    )
    assert.notEqual(run.settings, undefined, "Missing run settings")
    assert.notEqual(run.evidence.workload, undefined, "Missing workload evidence")
    assert.match(run.evidence.numericalSha256, /^[a-f0-9]{64}$/, "Missing numerical digest")
    const key = pairIdentity(run)
    assert.ok(!indexed.has(key), `Duplicate run identity: ${key}`)
    indexed.set(key, run)
  }
  return indexed
}
const originals = indexRuns(before)
const candidates = indexRuns(after)
assert.equal(originals.size, candidates.size, "Run counts differ")

function workload(report: PluginAnalysisReport) {
  const timing = report.performance
  return {
    reported_latency_samples: timing.reported_latency_samples,
    measured_blocks: timing.measured_blocks,
    buffer_bytes: timing.buffer_bytes,
    budget_us: timing.budget_us,
    block_sizes: timing.block_sizes.map(({ block_size, measured_blocks }) => ({
      block_size,
      measured_blocks
    }))
  }
}
function metric() {
  return { count: 0, nullCount: 0, maxAbsDelta: 0, maxBeforeAbsolute: 0, maxAfterAbsolute: 0 }
}
interface HarmonicMetrics {
  ordersDb: ReturnType<typeof metric>
  ordersNormalizedAmplitude: ReturnType<typeof metric>
  fundamentalGainDb: ReturnType<typeof metric>
  fundamentalNormalizedGain: ReturnType<typeof metric>
  thdPercentagePoints: ReturnType<typeof metric>
}
interface Pair {
  case: string
  iteration: number
  exactNonHarmonic: Record<string, boolean>
  workloadIdentical: boolean
  exactWholeNumericalDigest: boolean
  harmonics: HarmonicMetrics
}
function update(
  result: ReturnType<typeof metric>,
  original: unknown,
  changed: unknown,
  transform = (value: number) => value
) {
  assert.equal(original === null, changed === null, "Null/Nyquist validity must remain identical")
  if (original === null || changed === null) {
    result.nullCount += 1
    return
  }
  assert.ok(typeof original === "number" && typeof changed === "number", "Invalid measurement")
  assert.ok(Number.isFinite(original) && Number.isFinite(changed), "Nonfinite measurement")
  const a = transform(original)
  const b = transform(changed)
  assert.ok(Number.isFinite(a) && Number.isFinite(b), "Nonfinite normalized measurement")
  result.count += 1
  result.maxAbsDelta = Math.max(result.maxAbsDelta, Math.abs(a - b))
  result.maxBeforeAbsolute = Math.max(result.maxBeforeAbsolute, Math.abs(a))
  result.maxAfterAbsolute = Math.max(result.maxAfterAbsolute, Math.abs(b))
}

const pairs: Pair[] = []
for (const [key, original] of originals) {
  const changed = candidates.get(key)
  assert.ok(changed, `Missing candidate run: ${key}`)
  assert.deepEqual(original.settings, changed.settings, "Analysis settings changed")
  assert.deepEqual(
    original.evidence.workload,
    changed.evidence.workload,
    "Measurement workload dimensions changed"
  )
  const a = JSON.parse(await readFile(original.reportPath, "utf8")) as PluginAnalysisReport
  const b = JSON.parse(await readFile(changed.reportPath, "utf8")) as PluginAnalysisReport
  for (const [run, report] of [
    [original, a],
    [changed, b]
  ] as const) {
    assert.deepEqual(report.settings, run.settings, "Saved report does not match run settings")
    assert.deepEqual(
      workload(report),
      run.evidence.workload,
      "Saved report does not match workload evidence"
    )
  }
  const sections = [
    "settings",
    "responses",
    "spectrograms",
    "distortion",
    "oscilloscopes",
    "dynamics",
    "models"
  ] as const
  const exactNonHarmonic = Object.fromEntries(
    sections.map((section) => [section, isDeepStrictEqual(a[section], b[section])])
  )
  assert.ok(Object.values(exactNonHarmonic).every(Boolean), JSON.stringify(exactNonHarmonic))
  for (const section of sections) {
    const digest = original.evidence.sectionDigests[section]
    assert.ok(typeof digest === "string", `Missing section digest: ${section}`)
    assert.match(digest, /^[a-f0-9]{64}$/, `Invalid section digest: ${section}`)
    assert.equal(
      original.evidence.sectionDigests[section],
      changed.evidence.sectionDigests[section],
      `Exact decoded MessagePack numerical digest: ${section}`
    )
  }
  const ordersDb = metric()
  const ordersNormalizedAmplitude = metric()
  const fundamentalGainDb = metric()
  const fundamentalNormalizedGain = metric()
  const thdPercentagePoints = metric()
  assert.equal(a.harmonics.length, b.harmonics.length)
  for (const [channelIndex, channelA] of a.harmonics.entries()) {
    const channelB = b.harmonics[channelIndex]
    assert.ok(channelB)
    assert.equal(channelA.channel, channelB.channel)
    assert.deepEqual(channelA.frequency_hz, channelB.frequency_hz)
    assert.equal(channelA.orders_db.length, channelB.orders_db.length)
    for (const [orderIndex, orderA] of channelA.orders_db.entries()) {
      const orderB: Array<number | null> | undefined = channelB.orders_db[orderIndex]
      assert.ok(orderB)
      assert.equal(orderA.length, orderB.length)
      for (const [index, valueA] of orderA.entries()) {
        const valueB: unknown = orderB[index]
        assert.ok(valueB !== undefined)
        update(ordersDb, valueA, valueB)
        update(ordersNormalizedAmplitude, valueA, valueB, (value) => 10 ** (value / 20))
      }
    }
    for (const [field, result] of [
      ["fundamental_gain_db", fundamentalGainDb],
      ["thd_percent", thdPercentagePoints]
    ] as const) {
      assert.equal(channelA[field].length, channelB[field].length)
      for (const [index, valueA] of channelA[field].entries()) {
        const valueB: unknown = channelB[field][index]
        assert.ok(valueB !== undefined)
        update(result, valueA, valueB)
        if (field === "fundamental_gain_db")
          update(fundamentalNormalizedGain, valueA, valueB, (value) => 10 ** (value / 20))
      }
    }
  }
  pairs.push({
    case: caseLabel(original),
    iteration: original.iteration,
    exactNonHarmonic,
    workloadIdentical: true,
    exactWholeNumericalDigest:
      original.evidence.numericalSha256 === changed.evidence.numericalSha256,
    harmonics: {
      ordersDb,
      ordersNormalizedAmplitude,
      fundamentalGainDb,
      fundamentalNormalizedGain,
      thdPercentagePoints
    }
  })
}

function timings(runs: Run[]) {
  const ordered = [...runs].sort((a, b) => a.iteration - b.iteration)
  const warm = ordered
    .filter((run) => run.iteration > 0)
    .map((run) => run.analysisWallMs)
    .sort((a, b) => a - b)
  let warmMedianMs: number | null = null
  if (warm.length > 0) {
    const lower = warm.at(Math.floor((warm.length - 1) / 2))
    const upper = warm.at(Math.floor(warm.length / 2))
    assert.ok(lower !== undefined && upper !== undefined)
    warmMedianMs = (lower + upper) / 2
  }
  return {
    firstMs: ordered.find((run) => run.iteration === 0)?.analysisWallMs ?? null,
    warmSamplesMs: warm,
    warmMedianMs,
    warmMinMs: warm[0] ?? null,
    warmMaxMs: warm.at(-1) ?? null,
    allSamplesMs: ordered.map((run) => run.analysisWallMs),
    hostLifecycleWithoutQueriesMs: ordered.map((run) => run.lifecycleWithoutRepeatedQueriesMs)
  }
}
const timingComparison = [...new Set(before.results.map(identity))].map((key) => {
  const runs = before.results.filter((run) => identity(run) === key)
  const first = runs.at(0)
  assert.ok(first)
  const baseline = timings(runs)
  const changed = timings(after.results.filter((run) => identity(run) === key))
  return {
    case: caseLabel(first),
    before: baseline,
    after: changed,
    warmMedianReductionPercent:
      baseline.warmMedianMs !== null && changed.warmMedianMs !== null
        ? (1 - changed.warmMedianMs / baseline.warmMedianMs) * 100
        : null
  }
})
const firstPair = pairs.at(0)
assert.ok(firstPair)
const harmonicMaxima = Object.fromEntries(
  Object.keys(firstPair.harmonics).map((key) => [
    key,
    Math.max(...pairs.map((pair) => pair.harmonics[key as keyof HarmonicMetrics].maxAbsDelta))
  ])
)
const comparison = {
  before: before.metadata,
  after: after.metadata,
  pairCount: pairs.length,
  allNonHarmonicSectionsExactlyEqual: true,
  allWorkloadDimensionsExactlyEqual: true,
  harmonicMaxima,
  timingComparison,
  pairs
}
await writeFile(outputFile, JSON.stringify(comparison, null, 2) + "\n")
console.log(JSON.stringify({ pairCount: pairs.length, harmonicMaxima, timingComparison }, null, 2))
