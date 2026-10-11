import { createPackage } from "@electron/asar"
import { expect, test, _electron as electron, type ElectronApplication } from "@playwright/test"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type {
  WorkerOperation,
  WorkerRequestInput,
  WorkerResponse
} from "@heron/project-db/protocol"
import type { LiveWorkerRequest, LiveWorkerResponse } from "@heron/project-db/live-protocol"
import { closeElectronApplication } from "./support"

type LiveRequestInput = LiveWorkerRequest extends infer Request
  ? Request extends LiveWorkerRequest
    ? Omit<Request, "id">
    : never
  : never

type HarnessRequest =
  | { worker: "studio"; request: WorkerRequestInput<WorkerOperation> }
  | { worker: "live"; request: LiveRequestInput }

interface TemplateHarness {
  call(input: HarnessRequest): Promise<WorkerResponse | LiveWorkerResponse>
  shutdown(): Promise<void>
}

const fixtureMain = `
import { app } from "electron"
import { join } from "node:path"
import { Worker } from "node:worker_threads"

app.setPath("userData", join(import.meta.dirname, "user-data"))
const workers = new Map()
let nextId = 1

globalThis.heronTemplateHarness = {
  call({ worker: kind, request }) {
    let worker = workers.get(kind)
    if (!worker) {
      const filename = kind === "studio" ? "project-worker.mjs" : "live-worker.mjs"
      worker = new Worker(join(import.meta.dirname, "app.asar", "out", "main", filename), {
        execArgv: []
      })
      workers.set(kind, worker)
    }
    const id = nextId++
    return new Promise((resolveCall, rejectCall) => {
      const timeout = setTimeout(() => {
        cleanup()
        rejectCall(new Error("Packed " + kind + " worker timed out handling '" + request.type + "'"))
      }, 20_000)
      function cleanup() {
        clearTimeout(timeout)
        worker.off("message", onMessage)
        worker.off("error", onError)
        worker.off("exit", onExit)
      }
      function onMessage(response) {
        if (response.id !== id) return
        cleanup()
        resolveCall(response)
      }
      function onError(error) {
        cleanup()
        rejectCall(error)
      }
      function onExit(code) {
        cleanup()
        rejectCall(new Error("Packed " + kind + " worker exited with code " + code))
      }
      worker.on("message", onMessage)
      worker.on("error", onError)
      worker.on("exit", onExit)
      worker.postMessage({ id, ...request })
    })
  },
  async shutdown() {
    await Promise.all([...workers.values()].map((worker) => worker.terminate()))
  }
}
`

test("creates Studio and Live documents from packaged ASAR templates and reopens their archives", async () => {
  const appDirectory = resolve(import.meta.dirname, "..")
  const root = await mkdtemp(join(tmpdir(), "heron-template-asar-"))
  let application: ElectronApplication | undefined

  try {
    const source = join(root, "asar-source")
    await mkdir(source)
    await writeFile(join(source, "package.json"), JSON.stringify({ type: "module" }))
    for (const resource of [
      "main",
      "drizzle",
      "drizzle-live",
      "project-template.pglite.gz",
      "live-template.pglite.gz"
    ]) {
      await cp(join(appDirectory, "out", resource), join(source, "out", resource), {
        recursive: true
      })
    }
    await createPackage(source, join(root, "app.asar"))
    // Reuse installed PGlite beside the archive; only Heron's bundled resources
    // need ASAR packaging to reproduce the creation regression.
    await symlink(
      join(appDirectory, "node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir"
    )
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ type: "module", main: "main.mjs" })
    )
    await writeFile(join(root, "main.mjs"), fixtureMain)
    application = await electron.launch({
      args: [
        ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
        "--disable-gpu",
        "--no-sandbox",
        root
      ]
    })
    const runningApplication = application
    runningApplication.process().stderr?.on("data", (data) => {
      console.log(`template fixture stderr: ${String(data)}`)
    })

    async function call(input: HarnessRequest): Promise<unknown> {
      const response = await runningApplication.evaluate((_electron, request) => {
        const harness = (
          globalThis as typeof globalThis & {
            heronTemplateHarness: TemplateHarness
          }
        ).heronTemplateHarness
        return harness.call(request)
      }, input)
      expect(response).toMatchObject({ type: input.request.type, ok: true })
      return response.ok ? response.value : undefined
    }

    const studioConfiguration = {
      name: "Packed Studio",
      sampleRate: 48_000,
      timeSignatureNumerator: 7,
      timeSignatureDenominator: 8,
      waveformDisplayMode: "aggregate"
    } as const
    await call({
      worker: "studio",
      request: {
        type: "create",
        dataDir: join(root, "studio-initial"),
        name: studioConfiguration.name,
        sampleRate: studioConfiguration.sampleRate,
        numerator: studioConfiguration.timeSignatureNumerator,
        denominator: studioConfiguration.timeSignatureDenominator,
        waveformDisplayMode: studioConfiguration.waveformDisplayMode
      }
    })
    expect(await call({ worker: "studio", request: { type: "get-configuration" } })).toEqual(
      studioConfiguration
    )
    const studioArchive = join(root, "studio.hrs")
    await call({ worker: "studio", request: { type: "dump", outputPath: studioArchive } })
    await call({ worker: "studio", request: { type: "close" } })
    await call({
      worker: "studio",
      request: {
        type: "open",
        dataDir: join(root, "studio-reopened"),
        archivePath: studioArchive
      }
    })
    expect(await call({ worker: "studio", request: { type: "get-configuration" } })).toEqual(
      studioConfiguration
    )
    await call({ worker: "studio", request: { type: "close" } })

    const liveConfiguration = {
      name: "Packed Live",
      sampleRate: 48_000,
      audio: null,
      enabledMidiDeviceIds: []
    }
    await call({
      worker: "live",
      request: {
        type: "create",
        dataDir: join(root, "live-initial"),
        configuration: liveConfiguration
      }
    })
    expect(await call({ worker: "live", request: { type: "configuration" } })).toEqual(
      liveConfiguration
    )
    const liveArchive = join(root, "live.hrl")
    await call({ worker: "live", request: { type: "dump", outputPath: liveArchive } })
    await call({ worker: "live", request: { type: "close" } })
    await call({
      worker: "live",
      request: {
        type: "open",
        dataDir: join(root, "live-reopened"),
        archivePath: liveArchive
      }
    })
    expect(await call({ worker: "live", request: { type: "configuration" } })).toEqual(
      liveConfiguration
    )
    await call({ worker: "live", request: { type: "close" } })
  } finally {
    if (application) {
      await application
        .evaluate(() =>
          (
            globalThis as typeof globalThis & {
              heronTemplateHarness: TemplateHarness
            }
          ).heronTemplateHarness.shutdown()
        )
        .catch(() => undefined)
      await closeElectronApplication(application)
    }
    await rm(root, { recursive: true, force: true })
  }
})
