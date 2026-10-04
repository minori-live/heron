import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { cpus, release } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { setTimeout as delay } from "node:timers/promises"
import { parseArgs } from "node:util"
import { serialize } from "node:v8"
import { decode, encode } from "@msgpack/msgpack"
import { DEFAULT_PLUGIN_ANALYSIS_SETTINGS } from "../../../packages/contracts/src/plugin-analysis.ts"
import type { PluginAnalysisJobStatus } from "../src/main/audio-host/wire/generated/PluginAnalysisJobStatus.ts"
import type { PluginAnalysisReport } from "../src/main/audio-host/wire/generated/PluginAnalysisReport.ts"
import type { PluginAnalysisSettings } from "../src/main/audio-host/wire/generated/PluginAnalysisSettings.ts"
import type { ControlResponse } from "../src/main/audio-host/wire/rpc.ts"

// Diagnostic harness, not a timing assertion. Run BEFORE and AFTER against the same
// fixture bytes, release profile, machine load, settings, and polling intervals.
// The N-API MessagePack envelope is a local ABI. Transport proxies below are NOT
// Electron IPC or ECharts measurements; the separate IPC and rendering profiling
// harnesses measure those boundaries using these unchanged raw report files.
const { values } = parseArgs({
  options: {
    addon: { type: "string" },
    "build-profile": { type: "string" },
    label: { type: "string" },
    "fixture-path": { type: "string" },
    "fixture-id": { type: "string" },
    "fixture-format": { type: "string", default: "vst3" },
    cases: { type: "string", default: "passthrough,gain1,gain3" },
    modes: { type: "string", default: "sweep,random" },
    iterations: { type: "string", default: "4" },
    "include-x4": { type: "boolean", default: false },
    "poll-ms": { type: "string", default: "20" },
    "parameter-queries": { type: "string", default: "32" },
    "transport-iterations": { type: "string", default: "8" },
    "timeout-ms": { type: "string", default: "600000" },
    "report-dir": { type: "string" },
    output: { type: "string" },
    help: { type: "boolean", default: false }
  }
})

if (values.help) {
  console.log(`Usage: node apps/desktop/scripts/plugin-analysis-profile.ts
  --addon <absolute .node path> --build-profile release --label <revision>
  --fixture-path <Heron Gain.vst3> --fixture-id <native ID>
  [--cases passthrough,gain1,gain3] [--modes sweep,random] [--iterations 4]
  [--include-x4] [--poll-ms 20] [--parameter-queries 32]
  [--transport-iterations 8] [--timeout-ms 600000]
  [--output <JSON file>] [--report-dir <directory>]

Each case/mode receives a fresh runtime. Iteration 0 is its first run; later
iterations reuse that runtime but recreate all plug-in instances. No OS cache
flush is attempted. Raw reports and serialization/digest work are outside the
measured host lifecycle. Build-profile is caller supplied, not binary detection.`)
  process.exit(0)
}

assert.ok(values.addon, "--addon must identify the exact native binary")
assert.ok(values["build-profile"], "--build-profile must identify the actual Cargo profile")
assert.ok(values.label, "--label must identify the source revision/build")
const addonPath = resolve(values.addon)
const selectedCases = values.cases.split(",")
const selectedModes = values.modes.split(",")
assert.ok(selectedCases.every((name) => ["passthrough", "gain1", "gain3"].includes(name)))
assert.ok(selectedModes.every((name) => ["sweep", "random"].includes(name)))
assert.ok(["vst3", "clap"].includes(values["fixture-format"]))
if (selectedCases.some((name) => name !== "passthrough")) {
  assert.ok(values["fixture-path"], "gain cases require --fixture-path")
  assert.ok(values["fixture-id"], "gain cases require an explicit --fixture-id")
}
const fixturePath = values["fixture-path"] ? resolve(values["fixture-path"]) : null
const iterations = positiveInteger(values.iterations)
const pollMs = positiveInteger(values["poll-ms"])
const parameterQueries = positiveInteger(values["parameter-queries"])
const transportIterations = positiveInteger(values["transport-iterations"])
const timeoutMs = positiveInteger(values["timeout-ms"])
const repositoryRoot = resolve(import.meta.dirname, "../../..")
const reportDirectory = values["report-dir"] ? resolve(values["report-dir"]) : null
if (reportDirectory) await mkdir(reportDirectory, { recursive: true })

interface Runtime {
  request(bytes: Buffer): Promise<{ body: Uint8Array }>
  drainUiWork(): boolean
  drainEvents(): Uint8Array[]
  close(): unknown
}
interface Addon {
  AudioHostRuntime: new (
    controlThreads: number,
    blockingThreads: number,
    editorOwnerWindowHandle: undefined,
    uiWake: () => void
  ) => Runtime
}
interface WireSample {
  stage: string
  command: string
  requestBytes: number
  responseBytes: number
  encodeMs: number
  nativeRoundTripMs: number
  decodeMs: number
}
interface PhaseObservation {
  phase: string
  progress: number
  observedMs: number
}

function positiveInteger(value: string): number {
  const number = Number(value)
  assert.ok(Number.isSafeInteger(number) && number > 0, `Invalid positive integer: ${value}`)
  return number
}

function statistics(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((total, value) => total + value, 0)
  const percentile = (fraction: number) => sorted[Math.ceil((sorted.length - 1) * fraction)] ?? 0
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  return {
    count: sorted.length,
    sum,
    mean: sum / Math.max(1, sorted.length),
    median,
    p95: percentile(0.95),
    maximum: sorted.at(-1) ?? 0
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function artifactIdentity(path: string) {
  const files: Array<{ path: string; bytes: number; sha256: string }> = []
  async function visit(current: string): Promise<void> {
    if ((await stat(current)).isDirectory()) {
      for (const name of (await readdir(current)).sort()) await visit(join(current, name))
    } else {
      const bytes = await readFile(current)
      files.push({
        path: relative(path, current) || ".",
        bytes: bytes.length,
        sha256: sha256(bytes)
      })
    }
  }
  await visit(path)
  return { path, files }
}

function sourceRevision(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8"
    }).trim()
  } catch {
    return null
  }
}

function reportEvidence(report: PluginAnalysisReport) {
  const { performance: timing, ...numerical } = report
  // Preserve workload dimensions while excluding machine-dependent CPU timing
  // and deadline misses. RSS is recorded separately, never part of the digest.
  const workload = {
    reported_latency_samples: timing.reported_latency_samples,
    measured_blocks: timing.measured_blocks,
    buffer_bytes: timing.buffer_bytes,
    budget_us: timing.budget_us,
    block_sizes: timing.block_sizes.map(({ block_size, measured_blocks }) => ({
      block_size,
      measured_blocks
    }))
  }
  const sectionDigests = Object.fromEntries(
    Object.entries(numerical).map(([name, value]) => [name, sha256(encode(value))])
  )
  return {
    numericalSha256: sha256(encode({ ...numerical, performance: workload })),
    sectionDigests,
    workload,
    counts: {
      responses: report.responses.length,
      harmonics: report.harmonics.length,
      spectrograms: report.spectrograms.length,
      distortion: report.distortion.length,
      oscilloscopes: report.oscilloscopes.length,
      dynamics: report.dynamics.length,
      models: report.models.length
    },
    directResponses: report.responses
      .filter((response) => response.input === response.output)
      .map((response) => ({
        input: response.input,
        delaySamples: response.delay_samples,
        repeatErrorPercent: response.repeat_error_percent,
        magnitudeDb: statistics(response.magnitude_db)
      })),
    models: report.models.map((model) => ({
      channel: model.channel,
      suitable: model.suitable,
      validationErrorPercent: model.validation_error_percent
    }))
  }
}

function transportProxies(report: PluginAnalysisReport) {
  const cloneMs: number[] = []
  const serializeMs: number[] = []
  let v8Bytes = 0
  // First invocation is retained and identified separately; medians do not hide it.
  for (let index = 0; index < transportIterations; index += 1) {
    let started = performance.now()
    const clone = structuredClone(report)
    cloneMs.push(performance.now() - started)
    assert.equal(clone.responses.length, report.responses.length)
    started = performance.now()
    const bytes = serialize(report)
    serializeMs.push(performance.now() - started)
    v8Bytes = bytes.length
  }
  return {
    scope: "Node structuredClone and v8.serialize proxies; not Electron IPC",
    v8Bytes,
    structuredCloneMs: { first: cloneMs[0], samples: cloneMs, ...statistics(cloneMs) },
    v8SerializeMs: { first: serializeMs[0], samples: serializeMs, ...statistics(serializeMs) }
  }
}

function wireSummary(samples: WireSample[]) {
  const keys = [...new Set(samples.map((sample) => sample.stage))]
  return Object.fromEntries(
    keys.map((stage) => {
      const group = samples.filter((sample) => sample.stage === stage)
      return [
        stage,
        {
          calls: group.length,
          commands: [...new Set(group.map((sample) => sample.command))],
          requestBytes: statistics(group.map((sample) => sample.requestBytes)),
          responseBytes: statistics(group.map((sample) => sample.responseBytes)),
          encodeMs: statistics(group.map((sample) => sample.encodeMs)),
          nativeRoundTripMs: statistics(group.map((sample) => sample.nativeRoundTripMs)),
          decodeMs: statistics(group.map((sample) => sample.decodeMs))
        }
      ]
    })
  )
}

const metadata = {
  label: values.label,
  startedAt: new Date().toISOString(),
  sourceRevision: sourceRevision(),
  buildProfile: values["build-profile"],
  buildProfileSource: "caller supplied; compare identical build settings",
  addon: await artifactIdentity(addonPath),
  fixture: fixturePath ? await artifactIdentity(fixturePath) : null,
  fixtureId: values["fixture-id"] ?? null,
  fixtureFormat: values["fixture-format"],
  node: process.version,
  versions: process.versions,
  platform: process.platform,
  architecture: process.arch,
  osRelease: release(),
  cpus: { count: cpus().length, model: cpus()[0]?.model },
  runtime: {
    controlThreads: 2,
    blockingThreads: 4,
    uiWake: "native callback, coalesced setImmediate, plus 16 ms fallback",
    uiPumpMs: 16
  },
  pollMs,
  parameterQueries,
  transportIterations,
  iterations,
  cachePolicy:
    "Fresh runtime per case/mode; first iteration vs subsequent warm runtime; no OS cache flush",
  timingScope:
    "Host lifecycle includes N-API calls and polling; excludes proxy serialization, digests and file writes",
  phaseScope:
    "Coarse progress observations only; polling can miss phases and adds up to pollMs plus native round-trip",
  nativeRoundTripScope:
    "N-API scheduling, host execution and native response encoding; not isolated CPU work or Electron IPC"
}
const addonLoadStarted = performance.now()
const { AudioHostRuntime } = createRequire(import.meta.url)(addonPath) as Addon
const addonLoadMs = performance.now() - addonLoadStarted
const results: unknown[] = []
let processIteration = 0

for (const scenario of selectedCases) {
  const chainLength = scenario === "passthrough" ? 0 : scenario === "gain1" ? 1 : 3
  for (const mode of selectedModes) {
    for (const speed of values["include-x4"] ? ["ultra", "x4"] : ["ultra"]) {
      const settings: PluginAnalysisSettings = {
        ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS,
        linear_excitation: mode,
        fft_size: mode === "random" ? 65536 : 16384,
        model_order: mode === "random" ? 7 : 5,
        processing_speed: speed
      }
      let timerLast = performance.now()
      let timerGaps: number[] = []
      let uiPumpMs: number[] = []
      let stopped = false
      let uiImmediate: NodeJS.Immediate | null = null
      // Match AudioHostService's native wake policy, avoiding an artificial
      // timer delay on every host interaction. No editor is opened by this run.
      function scheduleUiDrain(): void {
        if (stopped || uiImmediate) return
        uiImmediate = setImmediate(() => {
          uiImmediate = null
          if (stopped) return
          const started = performance.now()
          const pending = runtime.drainUiWork()
          runtime.drainEvents()
          uiPumpMs.push(performance.now() - started)
          if (pending) scheduleUiDrain()
        })
      }
      const runtimeStarted = performance.now()
      const runtime = new AudioHostRuntime(2, 4, undefined, scheduleUiDrain)
      const runtimeCreateMs = performance.now() - runtimeStarted
      let requestId = 0
      const uiPump = setInterval(() => {
        const now = performance.now()
        timerGaps.push(now - timerLast)
        timerLast = now
        scheduleUiDrain()
      }, 16)
      scheduleUiDrain()
      try {
        for (let iteration = 0; iteration < iterations; iteration += 1) {
          timerGaps = []
          uiPumpMs = []
          timerLast = performance.now()
          const wire: WireSample[] = []
          const stages: Record<string, number> = {}
          const originalIds: string[] = []
          const instanceIds: string[] = []
          const operationId = randomUUID()
          const phases: PhaseObservation[] = []
          let completedBytes: Uint8Array | undefined
          let latencySamples = 0
          let editableParameters = 0
          let analysisLive = false
          let analysisStarted = 0
          const rssBefore = process.memoryUsage().rss
          const runStarted = performance.now()

          async function send(stage: string, command: Record<string, unknown>) {
            const request_id = ++requestId
            const started = performance.now()
            const bytes = Buffer.from(encode({ request_id, command }))
            const encoded = performance.now()
            const response = await runtime.request(bytes)
            const returned = performance.now()
            const decoded = decode(response.body) as ControlResponse
            const decodedAt = performance.now()
            const completed = decoded.result.plugin_analysis_status?.state === "completed"
            if (completed && !completedBytes) completedBytes = response.body
            wire.push({
              stage: stage === "analysis-poll" && completed ? "analysis-completed-report" : stage,
              command: String(command.type),
              requestBytes: bytes.length,
              responseBytes: response.body.length,
              encodeMs: encoded - started,
              nativeRoundTripMs: returned - encoded,
              decodeMs: decodedAt - returned
            })
            assert.equal(decoded.request_id, request_id)
            assert.notEqual(decoded.result.type, "error", JSON.stringify(decoded.result.error))
            return decoded.result
          }

          async function measure<T>(stage: string, work: () => Promise<T>): Promise<T> {
            const started = performance.now()
            const result = await work()
            stages[stage] = (stages[stage] ?? 0) + performance.now() - started
            return result
          }

          async function status(stage: string, type: string): Promise<PluginAnalysisJobStatus> {
            const response = await send(stage, { type, operation_id: operationId })
            assert.equal(response.type, "plugin-analysis")
            assert.ok(response.plugin_analysis_status)
            return response.plugin_analysis_status
          }

          function observe(current: PluginAnalysisJobStatus): void {
            if (current.state !== "running") return
            const previous = phases.at(-1)
            if (previous?.phase !== current.phase || previous.progress !== current.progress) {
              phases.push({
                phase: current.phase,
                progress: current.progress,
                observedMs: performance.now() - analysisStarted
              })
            }
          }

          try {
            for (let slot = 0; slot < chainLength; slot += 1) {
              const originalId = `plugin-analysis-lab-${randomUUID()}`
              const instanceId = `plugin-analysis-measure-${randomUUID()}`
              const load = {
                type: "load-plugin",
                locator: {
                  format: values["fixture-format"],
                  artifact_path: fixturePath,
                  native_id: values["fixture-id"]
                },
                plugin_kind: "effect",
                audio_mode: "stereo",
                active_aux_inputs: [],
                sample_rate: settings.sample_rate
              }
              const original = await measure("original-load", () =>
                send("original-load", {
                  ...load,
                  instance_id: originalId,
                  state: { version: 1, chunks: [] }
                })
              )
              assert.equal(original.type, "plugin-loaded")
              originalIds.push(originalId)
              const saved = await measure("state-save", () =>
                send("state-save", { type: "save-plugin-state", instance_id: originalId })
              )
              assert.equal(saved.type, "plugin-state")
              assert.ok(saved.state && "chunks" in saved.state)
              const listed = await measure("authoritative-parameters", () =>
                send("authoritative-parameters", {
                  type: "plugin-parameters",
                  instance_id: originalId
                })
              )
              assert.equal(listed.type, "plugin-parameters")
              assert.ok(listed.parameters)
              await measure("repeated-parameter-queries", async () => {
                for (let query = 0; query < parameterQueries; query += 1) {
                  const repeated = await send("repeated-parameter-queries", {
                    type: "plugin-parameters",
                    instance_id: originalId
                  })
                  assert.equal(repeated.type, "plugin-parameters")
                  assert.deepEqual(repeated.parameters, listed.parameters)
                }
              })
              const loaded = await measure("disposable-reload", () =>
                send("disposable-reload", { ...load, instance_id: instanceId, state: saved.state })
              )
              assert.equal(loaded.type, "plugin-loaded")
              instanceIds.push(instanceId)
              assert.notEqual(loaded.runtime_handle, original.runtime_handle)
              latencySamples += loaded.latency_samples ?? 0
              // Match PluginAnalysisService, including writable hidden parameters.
              const editable = listed.parameters.filter((parameter) => !parameter.read_only)
              editableParameters += editable.length
              await measure("authoritative-parameter-replay", async () => {
                for (const parameter of editable) {
                  await send("authoritative-parameter-replay", {
                    type: "set-plugin-parameter",
                    instance_id: instanceId,
                    parameter_key: parameter.parameter_key,
                    value: parameter.value,
                    gesture: "end"
                  })
                }
              })
            }

            analysisStarted = performance.now()
            // A rejected or malformed reply does not prove the native worker
            // never started. Reconcile cancellation before unloading endpoints.
            analysisLive = true
            const started = await send("analysis-start", {
              type: "start-plugin-analysis",
              operation_id: operationId,
              instance_ids: instanceIds,
              settings,
              reported_latency_samples: latencySamples
            })
            assert.equal(started.type, "plugin-analysis")
            assert.ok(started.plugin_analysis_status)
            let current = started.plugin_analysis_status
            observe(current)
            while (current.state === "running" && performance.now() - analysisStarted < timeoutMs) {
              await delay(pollMs)
              current = await status("analysis-poll", "plugin-analysis-status")
              observe(current)
            }
            const analysisWallMs = performance.now() - analysisStarted
            if (current.state !== "completed") {
              throw new Error(`Analysis did not complete: ${JSON.stringify(current)}`)
            }
            const report = current.report
            assert.deepEqual(report.settings, settings)
            assert.deepEqual(
              [
                report.responses.length,
                report.harmonics.length,
                report.spectrograms.length,
                report.distortion.length,
                report.oscilloscopes.length,
                report.dynamics.length,
                report.models.length
              ],
              [4, 2, 4, 2, 2, 2, 2],
              "Every requested measurement must complete"
            )
            assert.ok(
              report.responses.every((response) => response.magnitude_db.every(Number.isFinite))
            )
            assert.equal(report.performance.reported_latency_samples, latencySamples)
            await measure("analysis-release", async () => {
              assert.equal(
                (await status("analysis-release", "release-plugin-analysis")).state,
                "completed"
              )
            })
            analysisLive = false
            await measure("disposable-unload", async () => {
              for (const instance_id of [...instanceIds].reverse()) {
                await send("disposable-editor-close", { type: "close-plugin-editor", instance_id })
                await send("disposable-unload", { type: "unload-plugin", instance_id })
                instanceIds.pop()
              }
            })
            await measure("original-unload", async () => {
              for (const instance_id of [...originalIds].reverse()) {
                await send("original-editor-close", { type: "close-plugin-editor", instance_id })
                await send("original-unload", { type: "unload-plugin", instance_id })
                originalIds.pop()
              }
            })
            const lifecycleMs = performance.now() - runStarted
            const rssAfter = process.memoryUsage().rss
            const eventLoop = {
              scope: "Node timer gaps during host lifecycle; not Electron renderer responsiveness",
              expectedIntervalMs: 16,
              timerGapMs: statistics(timerGaps),
              drainUiWorkMs: statistics(uiPumpMs)
            }
            const evidence = reportEvidence(report)
            const transport = transportProxies(report)
            const reportPath = reportDirectory
              ? join(reportDirectory, `${scenario}-${mode}-${speed}-${iteration}.json`)
              : null
            const wireReportPath = reportPath ? `${reportPath}.msgpack` : null
            if (reportPath) {
              await writeFile(reportPath, JSON.stringify(report))
              assert.ok(completedBytes)
              await writeFile(wireReportPath!, completedBytes)
            }
            const result = {
              scenario,
              mode,
              speed,
              chainLength,
              iteration,
              processIteration: processIteration++,
              runtimeTemperature: iteration === 0 ? "first-runtime-iteration" : "warm-runtime",
              settings,
              runtimeCreateMs,
              editableParameters,
              stagesMs: stages,
              analysisWallMs,
              lifecycleMs,
              // Repeated queries are diagnostic overhead, not normal analysis preparation.
              lifecycleWithoutRepeatedQueriesMs:
                lifecycleMs - (stages["repeated-parameter-queries"] ?? 0),
              phaseObservations: phases.map((phase, index) => ({
                ...phase,
                observedSpanMs: (phases[index + 1]?.observedMs ?? analysisWallMs) - phase.observedMs
              })),
              wire: wireSummary(wire),
              eventLoop,
              rssBefore,
              rssAfter,
              evidence,
              nativePerformance: report.performance,
              transport,
              reportPath,
              wireReportPath
            }
            results.push(result)
            console.error(
              JSON.stringify({
                label: values.label,
                scenario,
                mode,
                speed,
                iteration,
                analysisWallMs,
                lifecycleMs,
                numericalSha256: evidence.numericalSha256,
                reportPath
              })
            )
          } finally {
            if (analysisLive) {
              let current = await status("cleanup-cancel", "cancel-plugin-analysis")
              const deadline = performance.now() + timeoutMs
              while (current.state === "running" && performance.now() < deadline) {
                await delay(pollMs)
                current = await status("cleanup-poll", "plugin-analysis-status")
              }
              assert.notEqual(
                current.state,
                "running",
                "Timed out waiting for safe endpoint retirement"
              )
              await status("cleanup-release", "release-plugin-analysis")
            }
            for (const instance_id of [...instanceIds, ...originalIds].reverse()) {
              await send("cleanup-editor-close", { type: "close-plugin-editor", instance_id })
              await send("cleanup-unload", { type: "unload-plugin", instance_id })
            }
          }
        }
      } finally {
        stopped = true
        clearInterval(uiPump)
        if (uiImmediate) clearImmediate(uiImmediate)
        runtime.close()
      }
    }
  }
}

const output = JSON.stringify({ metadata, addonLoadMs, results }, null, 2)
if (values.output) {
  const outputPath = resolve(values.output)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${output}\n`)
}
console.log(output)
