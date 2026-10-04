import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { cpus, platform, release } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { decode } from "@msgpack/msgpack"
import { _electron as electron } from "@playwright/test"
import { build } from "vite"
import type { PluginAnalysisReport, PluginAnalysisSnapshot } from "@heron/contracts"
import type { ControlResponse } from "../src/main/audio-host/wire/rpc.ts"

// node apps/desktop/scripts/plugin-analysis-ipc-profile.ts --wire-response <completed.msgpack>
// Supply the SAME native response to both revisions. File reading/decoding, startup,
// native processing and chart rendering are outside the measured interval. --report
// accepts JSON as a proxy; prefer native bytes to preserve MessagePack's array layout.
const { values } = parseArgs({
  options: {
    report: { type: "string" },
    "wire-response": { type: "string" },
    output: { type: "string" },
    samples: { type: "string", default: "20" }
  }
})
if (Boolean(values.report) === Boolean(values["wire-response"]))
  throw new Error("Supply exactly one of --wire-response or --report")
const samples = Number(values.samples)
if (!Number.isSafeInteger(samples) || samples < 1) throw new Error("Invalid warm sample count")
const inputPath = resolve(values["wire-response"] ?? values.report!)
const inputBytes = await readFile(inputPath)
const inputKind = values["wire-response"] ? "wire-response" : "json-report-proxy"
let report: PluginAnalysisReport
if (inputKind === "wire-response") {
  const response = decode(inputBytes) as Partial<ControlResponse> | null
  const status = response?.result?.plugin_analysis_status
  if (
    response?.result?.type !== "plugin-analysis" ||
    status?.state !== "completed" ||
    !status.report
  )
    throw new Error("Expected a completed native plugin-analysis response with a report")
  report = status.report
} else report = JSON.parse(inputBytes.toString("utf8")) as PluginAnalysisReport
if (!report.settings || !Array.isArray(report.responses) || !Array.isArray(report.spectrograms))
  throw new Error("Expected a complete PluginAnalysisReport")

const repository = resolve(import.meta.dirname, "../../..")
const cache = join(repository, "node_modules/.cache")
await mkdir(cache, { recursive: true })
const directory = await mkdtemp(join(cache, "analysis-ipc-profile-"))
const sourcePath = (path: string) => JSON.stringify(resolve(repository, path).replaceAll("\\", "/"))
const mainEntry = join(directory, "entry.js")
await writeFile(
  mainEntry,
  `
import { app, BrowserWindow, ipcMain } from "electron"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { decode } from "@msgpack/msgpack"
import { PluginAnalysisService } from ${sourcePath("apps/desktop/src/main/plugin-analysis/plugin-analysis-service.ts")}
import { rpcSuccess } from ${sourcePath("packages/contracts/src/rpc.ts")}

app.setPath("userData", process.env.HERON_IPC_PROFILE_USER_DATA)
const input = readFileSync(process.env.HERON_IPC_PROFILE_INPUT_PATH)
function loadReport() {
  if (process.env.HERON_IPC_PROFILE_INPUT_KIND !== "wire-response")
    return JSON.parse(input.toString("utf8"))
  const response = decode(input)
  const status = response?.result?.plugin_analysis_status
  if (response?.result?.type !== "plugin-analysis" || status?.state !== "completed" || !status.report)
    throw new Error("Expected a completed native plugin-analysis response with a report")
  return status.report
}
const report = loadReport()
const count = Number(process.env.HERON_IPC_PROFILE_COUNT)
const service = new PluginAnalysisService(
  { subscribePluginAnalysisNotifications: () => () => {} },
  () => [],
  { locale: "en", theme: "dark" }
)
// Seed only the completed report state; execute the production snapshot method.
const state = Reflect.get(service, "value")
Object.assign(state, {
  settings: report.settings, automatic: false, status: "complete", progress: 1,
  report, reportId: "profile-report", reportRevision: 0,
  comparisonEnabled: count === 3,
  comparisonReport: count === 3 ? loadReport() : null,
  differenceReport: count === 3 ? loadReport() : null
})
globalThis.profileSnapshotDurations = []
globalThis.profileVersions = process.versions
app.whenReady().then(async () => {
const window = new BrowserWindow({
  show: false,
  webPreferences: {
    preload: resolve(process.env.HERON_IPC_PROFILE_DIRECTORY, "preload.cjs"),
    sandbox: true, contextIsolation: true, nodeIntegration: false
  }
})
window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
window.webContents.on("will-navigate", event => event.preventDefault())
ipcMain.handle("analysis-profile:snapshot", (event, meta, knownReportId) => {
  if (event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame)
    throw new Error("Unexpected profile sender")
  const start = performance.now()
  const snapshot = service.snapshot(knownReportId)
  globalThis.profileSnapshotDurations.push(performance.now() - start)
  return rpcSuccess(meta, snapshot)
})
await window.loadFile(resolve(process.env.HERON_IPC_PROFILE_DIRECTORY, "index.html"))
}).catch(error => {
  console.error(error)
  app.exit(1)
})
`
)
await writeFile(
  join(directory, "preload.cjs"),
  `const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("analysisProfile", {
  snapshot: (meta, knownReportId) => ipcRenderer.invoke("analysis-profile:snapshot", meta, knownReportId)
})
`
)
await writeFile(
  join(directory, "index.html"),
  '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head><body></body></html>'
)
await build({
  configFile: false,
  root: directory,
  logLevel: "warn",
  resolve: {
    alias: { "@msgpack/msgpack": resolve(repository, "apps/desktop/node_modules/@msgpack/msgpack") }
  },
  build: {
    lib: { entry: mainEntry, formats: ["es"], fileName: () => "main.mjs" },
    outDir: join(directory, "dist"),
    // Same main-process compilation settings as vite.main.config.ts.
    minify: false,
    target: "node22",
    rolldownOptions: { external: ["electron", /^node:/] }
  }
})

interface Sample {
  roundTripMs: number
  snapshotCloneMs: number
  remainderMs: number
}

function summarize(measurements: number[]) {
  const sorted = [...measurements].sort((a, b) => a - b)
  const lowerMiddle = sorted[Math.floor((sorted.length - 1) / 2)]
  const upperMiddle = sorted[Math.floor(sorted.length / 2)]
  if (lowerMiddle === undefined || upperMiddle === undefined) throw new Error("No timing samples")
  return {
    median: (lowerMiddle + upperMiddle) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minimum: sorted[0],
    maximum: sorted.at(-1)!
  }
}

const results = []
let versions: Record<string, string | undefined> = {}
for (const reportCount of [1, 3]) {
  for (const omitted of [false, true]) {
    const userData = join(directory, `profile-${reportCount}-${omitted}`)
    const application = await electron.launch({
      args: [join(directory, "dist/main.mjs")],
      timeout: 30_000,
      env: {
        ...process.env,
        HERON_IPC_PROFILE_DIRECTORY: directory,
        HERON_IPC_PROFILE_USER_DATA: userData,
        HERON_IPC_PROFILE_INPUT_PATH: inputPath,
        HERON_IPC_PROFILE_INPUT_KIND: inputKind,
        HERON_IPC_PROFILE_COUNT: String(reportCount)
      }
    })
    try {
      const page = await application.firstWindow({ timeout: 30_000 })
      await page.waitForFunction(() => "analysisProfile" in window)
      const measurement = await page.evaluate(
        async ({ samples, omitted, reportCount }) => {
          const bridge = Reflect.get(window, "analysisProfile") as {
            snapshot(
              meta: { protocolVersion: number; requestId: string },
              knownReportId?: string
            ): Promise<{ ok: boolean; value: PluginAnalysisSnapshot }>
          }
          const roundTrips: number[] = []
          let jsonLength = 0
          for (let i = 0; i <= samples; i++) {
            const meta = { protocolVersion: 2, requestId: crypto.randomUUID() }
            const start = performance.now()
            const result = await bridge.snapshot(meta, omitted ? "profile-report" : undefined)
            roundTrips.push(performance.now() - start)
            const received = [
              result.value.report,
              result.value.comparisonReport,
              result.value.differenceReport
            ].filter(Boolean).length
            if (!result.ok || received !== (omitted ? 0 : reportCount))
              throw new Error("Unexpected report payload")
            // Outside every measured interval, and only after the final warm sample.
            if (i === samples) jsonLength = JSON.stringify(result).length
          }
          return { roundTrips, jsonLength }
        },
        { samples, omitted, reportCount }
      )
      const main = await application.evaluate(() => ({
        durations: Reflect.get(globalThis, "profileSnapshotDurations") as number[],
        versions: Reflect.get(globalThis, "profileVersions") as Record<string, string | undefined>
      }))
      versions = main.versions
      const paired: Sample[] = measurement.roundTrips.map((roundTripMs, index) => {
        const snapshotCloneMs = main.durations[index]
        if (snapshotCloneMs === undefined) throw new Error("Missing main-process timing sample")
        return { roundTripMs, snapshotCloneMs, remainderMs: roundTripMs - snapshotCloneMs }
      })
      const warm = paired.slice(1)
      results.push({
        reportCount,
        reportsOmittedByKnownReportId: omitted,
        responseJsonCodeUnits: measurement.jsonLength,
        firstRequest: paired[0],
        warmSummaryMs: {
          roundTrip: summarize(warm.map((item) => item.roundTripMs)),
          snapshotClone: summarize(warm.map((item) => item.snapshotCloneMs)),
          remainder: summarize(warm.map((item) => item.remainderMs))
        },
        warm
      })
    } finally {
      await application.close()
    }
  }
}

const result = {
  sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
  dirty: Boolean(
    execFileSync("git", ["status", "--porcelain"], { cwd: repository, encoding: "utf8" }).trim()
  ),
  platform: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  versions,
  input: {
    path: inputPath,
    kind: inputKind,
    sha256: createHash("sha256").update(inputBytes).digest("hex"),
    bytes: inputBytes.length,
    settings: report.settings
  },
  samples,
  method:
    "Fresh hidden Electron process for each scenario; first request then sequential warm requests. Actual PluginAnalysisService.snapshot(), RPC success envelope, ipcRenderer.invoke and sandboxed contextBridge. Three-report payload decodes the same input independently three times, modeling payload size rather than real comparison results. wire-response uses the production @msgpack/msgpack decoder on actual native response bytes; json-report-proxy uses JSON.parse with different array construction. Empty catalog/plugins; no native execution, app lifecycle/RPC authentication, file read/decode, startup or chart work timed. Remainder includes IPC serialization, scheduling and contextBridge copies, not pure serialization. No forced GC.",
  results
}
const json = JSON.stringify(result, null, 2)
if (values.output) await writeFile(resolve(values.output), `${json}\n`)
console.log(json)
