import { beforeEach, describe, expect, it, vi } from "vitest"
const bridge = vi.hoisted(() => ({
  receive: null as null | ((message: unknown) => void),
  listeners: new Map<string, (value: unknown) => void>(),
  post: vi.fn(),
  terminate: vi.fn(async () => 0),
  create: vi.fn(),
  open: vi.fn()
}))
vi.mock("node:worker_threads", () => {
  const mocked = {
    parentPort: {
      on: (_event: string, listener: (value: unknown) => void) => {
        bridge.receive = listener
      },
      postMessage: (message: unknown) => bridge.listeners.get("message")?.(structuredClone(message))
    },
    Worker: class {
      on(event: string, listener: (value: unknown) => void) {
        bridge.listeners.set(event, listener)
      }
      postMessage(message: unknown) {
        bridge.post(message)
        bridge.receive?.(structuredClone(message))
      }
      terminate = bridge.terminate
    }
  }
  return { ...mocked, default: mocked }
})
vi.mock("@heron/project-db/live-node", () => ({
  LiveDatabase: { create: bridge.create, open: bridge.open }
}))
const configuration = { name: "Stage", sampleRate: 48000, audio: null, enabledMidiDeviceIds: [] }
const graph = { sampleRate: 48000, channels: [], sends: [], plugins: [] }
async function fixture() {
  const database = {
    close: vi.fn(async () => undefined),
    configuration: vi.fn(async () => configuration),
    updateConfiguration: vi.fn(async () => 1),
    revision: vi.fn(async () => 1),
    mixerSnapshot: vi.fn(async () => graph),
    midiBindings: vi.fn(async () => []),
    pluginParameterValues: vi.fn(async () => []),
    replaceBaseline: vi.fn(async () => 2),
    dump: vi.fn(async () => undefined)
  }
  bridge.create.mockResolvedValue(database)
  bridge.open.mockResolvedValue(database)
  await import("./live-worker")
  const { LiveWorkerClient } = await import("./live-worker-client")
  return { database, client: new LiveWorkerClient(new URL("file:///live-worker.mjs")) }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  bridge.listeners.clear()
  bridge.receive = null
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

describe("Live worker message boundary", () => {
  it("round-trips every operation through the real dispatcher and client", async () => {
    const { client, database } = await fixture()
    await client.create("working", configuration)
    expect(bridge.create).toHaveBeenCalledWith("working", configuration)
    expect(await client.configuration()).toEqual(configuration)
    expect(await client.updateConfiguration(configuration, 0)).toBe(1)
    expect(database.updateConfiguration).toHaveBeenCalledWith(configuration, 0)
    expect(await client.revision()).toBe(1)
    expect(await client.mixerSnapshot()).toEqual(graph)
    expect(await client.midiBindings()).toEqual([])
    expect(await client.pluginParameterValues()).toEqual([])
    const snapshot = { graph, parameterValues: [] }
    expect(await client.replaceBaseline(snapshot, [], 1)).toBe(2)
    expect(database.replaceBaseline).toHaveBeenCalledWith(snapshot, [], 1)
    await client.dump("archive.hrl")
    expect(database.dump).toHaveBeenCalledWith("archive.hrl")
    await client.open("reopened", "archive.hrl")
    expect(database.close).toHaveBeenCalledTimes(1)
    expect(bridge.open).toHaveBeenCalledWith("reopened", "archive.hrl")
    await client.close()
    await expect(client.configuration()).rejects.toMatchObject({ code: "live-worker-failed" })
    await client.terminate()
    expect(bridge.terminate).toHaveBeenCalledOnce()
    await client.terminate()
    await expect(client.revision()).rejects.toThrow("closed")
  })

  it("preserves typed storage failures and continues processing subsequent requests", async () => {
    const { client, database } = await fixture()
    bridge.open.mockRejectedValueOnce(
      Object.assign(new Error("wrong archive"), { code: "format-mismatch" })
    )
    await expect(client.open("wrong", "studio.hrs")).rejects.toMatchObject({
      code: "format-mismatch"
    })
    await client.create("working", configuration)
    database.updateConfiguration.mockRejectedValueOnce(
      Object.assign(new Error("stale"), { code: "revision-conflict" })
    )
    await expect(client.updateConfiguration(configuration, 99)).rejects.toMatchObject({
      code: "revision-conflict"
    })
    expect(await client.configuration()).toEqual(configuration)
    await client.terminate()
  })

  it("serializes a pending write before a read and closes outstanding calls on termination", async () => {
    const { client, database } = await fixture()
    await client.create("working", configuration)
    let finish!: () => void
    database.updateConfiguration.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return 2
    })
    const write = client.updateConfiguration(configuration, 1)
    const read = client.configuration()
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(database.configuration).not.toHaveBeenCalled()
    finish()
    expect(await write).toBe(2)
    expect(await read).toEqual(configuration)
    bridge.receive = null
    const pending = client.revision()
    const rejected = expect(pending).rejects.toThrow("terminated")
    await client.terminate()
    await rejected
  })

  it.each(["error", "exit"])("rejects outstanding requests after worker %s", async (event) => {
    const { client } = await fixture()
    bridge.receive = null
    const pending = client.revision()
    const rejected = expect(pending).rejects.toThrow()
    bridge.listeners.get(event)?.(event === "error" ? new Error("worker failed") : 1)
    await rejected
    await expect(client.configuration()).rejects.toThrow("closed")
  })

  it("rejects a failed dispatch without retaining a pending request, and ignores late responses", async () => {
    const { client } = await fixture()
    bridge.post.mockImplementationOnce(() => {
      throw new Error("clone failed")
    })
    await expect(client.revision()).rejects.toThrow("clone failed")
    bridge.listeners.get("message")?.({ id: 1, type: "revision", ok: true, value: 999 })
    await client.create("working", configuration)
    expect(await client.revision()).toBe(1)
    await client.terminate()
  })
})
