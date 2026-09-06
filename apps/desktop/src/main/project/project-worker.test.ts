import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const worker = vi.hoisted(() => ({
  postMessage: vi.fn(),
  on: vi.fn()
}))

const graph = vi.hoisted(() => ({
  sampleRate: 48_000,
  tracks: [],
  channels: [],
  audioClips: [],
  sends: [],
  plugins: [],
  midiClips: [],
  tempoMap: {
    ticksPerQuarter: 960,
    tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
    timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
  },
  keySignatureEvents: [{ tick: 0, fifths: 0, mode: "major" }]
}))

const database = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  getConfiguration: vi.fn(async () => ({ name: "Project" })),
  updateConfiguration: vi.fn(async (value) => value),
  listAssets: vi.fn(async () => []),
  mixerSnapshot: vi.fn(async () => structuredClone(graph)),
  applyCommand: vi.fn(async () => structuredClone(graph)),
  importMidi: vi.fn(async () => undefined),
  rollbackMidi: vi.fn(async () => undefined),
  savePluginStates: vi.fn(async () => undefined),
  assetContentHashes: vi.fn(async () => []),
  defaultRecordingTrack: vi.fn(async () => null),
  assetsMissingWaveform: vi.fn(async () => []),
  deleteAssets: vi.fn(async () => undefined),
  dumpTo: vi.fn(async () => undefined),
  importLargeObject: vi.fn(async (_path, _asset, progress, cancelled) => {
    progress(3, 9)
    expect(cancelled()).toBe(false)
    return 27
  }),
  readLargeObject: vi.fn(async () => new Uint8Array([1, 2])),
  readWaveform: vi.fn(async () => null),
  storeWaveform: vi.fn(async () => undefined)
}))

const projectDatabase = vi.hoisted(() => ({
  create: vi.fn(async () => database),
  open: vi.fn(async () => database)
}))

vi.mock("node:worker_threads", () => ({
  default: { parentPort: worker },
  parentPort: worker
}))
vi.mock("node:crypto", () => ({
  default: { randomUUID: vi.fn(() => "uuid-1") },
  randomUUID: vi.fn(() => "uuid-1")
}))
vi.mock("@heron/project-db/node", () => ({ ProjectDatabase: projectDatabase }))
vi.mock("@heron/project-model", () => ({
  applyToGraph: vi.fn(() => structuredClone(graph)),
  validateGraph: vi.fn()
}))

type Message = Record<string, unknown> & { id: number; type: string }
let receive!: (message: Message) => void

async function send(message: Message): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    worker.postMessage.mockImplementation((value) => {
      if (value.id === message.id) resolve(value)
    })
    receive(message)
  })
}

describe("project worker", () => {
  beforeAll(async () => {
    await import("./project-worker")
    expect(worker.on).toHaveBeenCalledWith("message", expect.any(Function))
    receive = worker.on.mock.calls.find(([event]) => event === "message")![1]
  })
  beforeEach(async () => {
    await send({ id: 0, type: "close" })
    database.close.mockClear()
    projectDatabase.open.mockClear()
    projectDatabase.create.mockClear()
  })

  it("releases acknowledged commits across a long editing session and replays an unacknowledged commit", async () => {
    await send({ id: 100, type: "open", dataDir: "/data" })
    for (let index = 0; index < 2_050; index += 1) {
      const operationId = `edit-${index}`
      const prepared = await send({
        id: 101,
        type: "prepare-project-command",
        operationId,
        baseRevision: index,
        command: { type: "batch", commands: [] },
        fallbackOutputId: "output"
      })
      expect(prepared.ok).toBe(true)
      const token = (prepared.value as { token: unknown }).token
      const committed = await send({ id: 102, type: "commit-project-command", token })
      expect(committed.ok).toBe(true)
      if (index === 0) {
        const calls = database.applyCommand.mock.calls.length
        expect(await send({ id: 103, type: "commit-project-command", token })).toMatchObject({
          ok: true,
          value: committed.value
        })
        expect(database.applyCommand.mock.calls.length).toBe(calls)
        await send({
          id: 107,
          type: "acknowledge-project-command",
          token: { ...(token as object), id: "stale" }
        })
        expect(await send({ id: 108, type: "project-command-status", operationId })).toMatchObject({
          value: { state: "committed" }
        })
      }
      await send({ id: 104, type: "acknowledge-project-command", token })
      expect(await send({ id: 105, type: "project-command-status", operationId })).toMatchObject({
        value: { state: "absent" }
      })
    }
    await send({ id: 106, type: "close" })
    database.close.mockClear()
    projectDatabase.open.mockClear()
  })

  it("keeps a failed database transaction prepared for explicit abort", async () => {
    await send({ id: 200, type: "open", dataDir: "/data" })
    const prepared = await send({
      id: 201,
      type: "prepare-project-command",
      operationId: "failed-read",
      baseRevision: 0,
      command: { type: "batch", commands: [] },
      fallbackOutputId: "output"
    })
    const token = (prepared.value as { token: unknown }).token
    database.applyCommand.mockRejectedValueOnce(new Error("snapshot read rolled back"))
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(await send({ id: 202, type: "commit-project-command", token })).toMatchObject({
      ok: false
    })
    expect(
      await send({ id: 203, type: "project-command-status", operationId: "failed-read" })
    ).toMatchObject({ value: { state: "prepared" } })
    await send({ id: 204, type: "abort-project-command", token })
    expect(
      await send({ id: 205, type: "project-command-status", operationId: "failed-read" })
    ).toMatchObject({ value: { state: "absent" } })
    log.mockRestore()
  })

  it("serializes database operations and reconciles prepared project commands", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(await send({ id: 1, type: "get-configuration" })).toMatchObject({
      id: 1,
      ok: false,
      error: { outcome: "quarantined", retry: "after-reconcile" }
    })
    expect(consoleError).toHaveBeenCalled()

    expect(
      await send({
        id: 2,
        type: "create",
        dataDir: "/data",
        name: "Project",
        sampleRate: 48_000,
        numerator: 4,
        denominator: 4,
        waveformDisplayMode: "separate"
      })
    ).toMatchObject({ ok: true })
    expect(projectDatabase.create).toHaveBeenCalledOnce()

    const operations: Message[] = [
      { id: 3, type: "get-configuration" },
      { id: 4, type: "update-configuration", configuration: { name: "Renamed" } },
      { id: 5, type: "list-assets" },
      { id: 6, type: "mixer-snapshot" },
      { id: 7, type: "import-midi", source: {}, command: {}, fallbackOutputId: "master" },
      { id: 8, type: "rollback-midi", sourceId: "source", command: {}, fallbackOutputId: "master" },
      { id: 9, type: "save-plugin-states", states: [] },
      { id: 10, type: "asset-content-hashes", ids: ["asset"] },
      { id: 11, type: "default-recording-track" },
      { id: 12, type: "assets-missing-waveform", cacheVersion: 2 },
      { id: 13, type: "delete-assets", ids: ["asset"] },
      { id: 14, type: "dump", outputPath: "/archive" },
      { id: 15, type: "read-large-object", assetId: "asset" },
      {
        id: 16,
        type: "read-waveform",
        assetId: "asset",
        startFrame: 0,
        endFrame: 10,
        maxBuckets: 2
      },
      { id: 17, type: "store-waveform", assetId: "asset", waveform: {} }
    ]
    for (const operation of operations) {
      expect(await send(operation)).toMatchObject({
        id: operation.id,
        type: operation.type,
        ok: true
      })
    }

    const prepared = await send({
      id: 18,
      type: "prepare-project-command",
      operationId: "operation-1",
      baseRevision: 4,
      command: { type: "batch", commands: [] },
      fallbackOutputId: "master"
    })
    expect(prepared).toMatchObject({
      ok: true,
      value: { token: { id: "uuid-1", operationId: "operation-1", baseRevision: 4 } }
    })
    expect(
      await send({ id: 19, type: "project-command-status", operationId: "operation-1" })
    ).toMatchObject({
      value: { state: "prepared" }
    })
    expect(
      await send({
        id: 20,
        type: "prepare-project-command",
        operationId: "operation-1",
        baseRevision: 4,
        command: { type: "batch", commands: [] },
        fallbackOutputId: "master"
      })
    ).toMatchObject({ value: prepared.value })

    expect(
      await send({
        id: 21,
        type: "commit-project-command",
        token: { id: "stale", operationId: "operation-1", baseRevision: 4 }
      })
    ).toMatchObject({ ok: false })
    expect(
      await send({
        id: 22,
        type: "commit-project-command",
        token: { id: "uuid-1", operationId: "operation-1", baseRevision: 4 }
      })
    ).toMatchObject({ ok: true, value: { token: { operationId: "operation-1" } } })
    expect(
      await send({ id: 23, type: "project-command-status", operationId: "operation-1" })
    ).toMatchObject({
      value: { state: "committed" }
    })
    expect(
      await send({
        id: 24,
        type: "prepare-project-command",
        operationId: "operation-1",
        baseRevision: 4,
        command: { type: "batch", commands: [] },
        fallbackOutputId: "master"
      })
    ).toMatchObject({ value: { token: { operationId: "operation-1" } } })

    expect(
      await send({ id: 25, type: "project-command-status", operationId: "absent" })
    ).toMatchObject({
      value: { state: "absent" }
    })
    expect(
      await send({
        id: 26,
        type: "abort-project-command",
        token: { id: "uuid-1", operationId: "operation-1", baseRevision: 4 }
      })
    ).toMatchObject({ ok: true })

    const imported = await send({
      id: 27,
      type: "import-large-object",
      filePath: "/audio.wav",
      operationId: "import-1",
      asset: {}
    })
    expect(imported).toMatchObject({ ok: true, value: 27 })
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "progress",
      operationId: "import-1",
      completed: 3,
      total: 9
    })

    expect(await send({ id: 28, type: "cancel", operationId: "import-2" })).toMatchObject({
      ok: true
    })
    expect(await send({ id: 29, type: "close" })).toMatchObject({ ok: true })
    expect(database.close).toHaveBeenCalledOnce()
    expect(
      await send({ id: 30, type: "open", dataDir: "/data", archivePath: "/archive" })
    ).toMatchObject({ ok: true })
    expect(projectDatabase.open).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
