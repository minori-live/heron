import assert from "node:assert/strict"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"
import { PGlite } from "@electric-sql/pglite"
import type { MixerGraphSnapshot } from "@heron/contracts"
import type {
  WorkerOperation,
  WorkerProgress,
  WorkerRequestInput,
  WorkerResponse,
  WorkerResult
} from "@heron/project-db/protocol"
import type { LiveWorkerRequest, LiveWorkerResponse } from "@heron/project-db/live-protocol"

const appDirectory = resolve(import.meta.dirname, "..")
const outputDirectory = resolve(appDirectory, "out")
const templatePath = resolve(outputDirectory, "project-template.pglite.gz")
const migrationsJournalPath = resolve(outputDirectory, "drizzle/meta/_journal.json")
const liveTemplatePath = resolve(outputDirectory, "live-template.pglite.gz")
const liveMigrationsJournalPath = resolve(outputDirectory, "drizzle-live/meta/_journal.json")
const workerPath = resolve(outputDirectory, "main/project-worker.mjs")
const liveWorkerPath = resolve(outputDirectory, "main/live-worker.mjs")
const workingDirectory = await mkdtemp(join(tmpdir(), "heron-built-project-template-"))
const dataDir = join(workingDirectory, "pgdata")
const expectedConfiguration = {
  name: "Built template smoke",
  sampleRate: 48_000,
  timeSignatureNumerator: 7,
  timeSignatureDenominator: 8,
  waveformDisplayMode: "aggregate"
} as const
const worker = new Worker(pathToFileURL(workerPath))
const liveWorker = new Worker(pathToFileURL(liveWorkerPath), { execArgv: [] })
let nextId = 1

function call(request: WorkerRequestInput<WorkerOperation>): Promise<WorkerResult> {
  const id = nextId++
  return new Promise((resolveCall, rejectCall) => {
    const timeout = setTimeout(() => {
      cleanup()
      rejectCall(new Error(`Built project worker timed out handling '${request.type}'`))
    }, 20_000)

    const cleanup = (): void => {
      clearTimeout(timeout)
      worker.off("error", onError)
      worker.off("message", onMessage)
    }
    const onError = (error: Error): void => {
      cleanup()
      rejectCall(error)
    }
    const onMessage = (message: WorkerResponse | WorkerProgress): void => {
      if (!("id" in message) || message.id !== id) return
      cleanup()
      if (message.ok) resolveCall(message.value)
      else rejectCall(new Error(JSON.stringify(message.error)))
    }

    worker.on("error", onError)
    worker.on("message", onMessage)
    worker.postMessage({ id, ...request })
  })
}

type LiveRequestInput = LiveWorkerRequest extends infer R
  ? R extends LiveWorkerRequest
    ? Omit<R, "id">
    : never
  : never

function callLive(request: LiveRequestInput): Promise<unknown> {
  const id = nextId++
  return new Promise((resolveCall, rejectCall) => {
    const timeout = setTimeout(() => {
      cleanup()
      rejectCall(new Error(`Built Live worker timed out handling '${request.type}'`))
    }, 20_000)
    const cleanup = (): void => {
      clearTimeout(timeout)
      liveWorker.off("error", onError)
      liveWorker.off("message", onMessage)
    }
    const onError = (error: Error): void => {
      cleanup()
      rejectCall(error)
    }
    const onMessage = (message: LiveWorkerResponse): void => {
      if (message.id !== id) return
      cleanup()
      if (message.ok) resolveCall(message.value)
      else rejectCall(new Error(message.error.code))
    }
    liveWorker.on("error", onError)
    liveWorker.on("message", onMessage)
    liveWorker.postMessage({ id, ...request })
  })
}

try {
  await Promise.all([
    access(templatePath),
    access(migrationsJournalPath),
    access(workerPath),
    access(liveTemplatePath),
    access(liveMigrationsJournalPath),
    access(liveWorkerPath)
  ])
  await call({
    type: "create",
    dataDir,
    name: expectedConfiguration.name,
    sampleRate: expectedConfiguration.sampleRate,
    numerator: expectedConfiguration.timeSignatureNumerator,
    denominator: expectedConfiguration.timeSignatureDenominator,
    waveformDisplayMode: expectedConfiguration.waveformDisplayMode
  })
  assert.deepEqual(await call({ type: "get-configuration" }), expectedConfiguration)
  await call({ type: "close" })
  await call({ type: "open", dataDir })
  assert.deepEqual(await call({ type: "get-configuration" }), expectedConfiguration)
  await call({ type: "close" })
  const live = await PGlite.create({
    dataDir: join(workingDirectory, "live-pgdata"),
    loadDataDir: new Blob([await readFile(liveTemplatePath)])
  })
  try {
    const tables = await live.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'"
    )
    const names = tables.rows.map((row) => row.tablename)
    assert(names.includes("live_document"))
    assert(names.includes("mixer_channels"))
    assert(!names.includes("tracks"))
    assert(!names.includes("audio_clips"))
    const columns = await live.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'mixer_channels'"
    )
    assert(
      !columns.rows.some(
        (row) => row.column_name === "system_role" || row.column_name === "record_armed"
      )
    )
  } finally {
    await live.close()
  }
  const liveConfiguration = {
    name: "Built Live smoke",
    sampleRate: 48_000,
    audio: null,
    enabledMidiDeviceIds: []
  }
  await callLive({
    type: "create",
    dataDir: join(workingDirectory, "live-working"),
    configuration: liveConfiguration
  })
  assert.deepEqual(await callLive({ type: "configuration" }), liveConfiguration)
  const liveGraph = (await callLive({ type: "mixer-snapshot" })) as MixerGraphSnapshot
  assert.deepEqual(
    liveGraph.channels.map((channel) => channel.kind),
    ["audio", "master", "output"]
  )
  const editedGraph = structuredClone(liveGraph)
  editedGraph.channels.find((channel) => channel.id === "audio-1")!.gainDb = -9
  assert.equal(
    await callLive({
      type: "replace-baseline",
      snapshot: { graph: editedGraph, parameterValues: [] },
      bindings: [],
      expectedRevision: 0
    }),
    1
  )
  const liveArchive = join(workingDirectory, "built.hrl")
  await callLive({ type: "dump", outputPath: liveArchive })
  await callLive({ type: "close" })
  await callLive({
    type: "open",
    dataDir: join(workingDirectory, "live-reopened"),
    archivePath: liveArchive
  })
  assert.deepEqual(await callLive({ type: "configuration" }), liveConfiguration)
  assert.equal(await callLive({ type: "revision" }), 1)
  const reopenedGraph = (await callLive({ type: "mixer-snapshot" })) as typeof liveGraph
  assert.equal(reopenedGraph.channels.find((channel) => channel.id === "audio-1")?.gainDb, -9)
  await callLive({ type: "close" })
  process.stdout.write("Verified Studio and Live built worker template round-trips.\n")
} finally {
  await Promise.all([worker.terminate(), liveWorker.terminate()])
  await rm(workingDirectory, { force: true, recursive: true })
}
