import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LiveDocumentConfiguration, LiveRuntimeSnapshot } from "@heron/contracts"
import { LiveDocumentService } from "./live-document-service"
import type { LiveWorkerClient } from "./live-worker-client"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "heron-live-reconcile-"))
  roots.push(root)
  let revision = 0
  let configuration: LiveDocumentConfiguration = {
    name: "Stage",
    sampleRate: 48000,
    audio: null,
    enabledMidiDeviceIds: []
  }
  let snapshot: LiveRuntimeSnapshot = {
    graph: {
      sampleRate: 48000,
      channels: (["master", "output"] as const).map((kind) => ({
        id: kind,
        kind,
        name: kind,
        color: "#4F8CFF",
        sortOrder: 0,
        inputSource: null,
        inputFormat: null,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: null,
        outputBus: null,
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: kind === "output" ? [1, 2] : []
      })),
      sends: [],
      plugins: []
    },
    parameterValues: []
  }
  const worker = {
    create: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    configuration: vi.fn(async () => structuredClone(configuration)),
    revision: vi.fn(async () => revision),
    mixerSnapshot: vi.fn(async () => structuredClone(snapshot.graph)),
    pluginParameterValues: vi.fn(async () => structuredClone(snapshot.parameterValues)),
    midiBindings: vi.fn(async () => []),
    replaceBaseline: vi.fn(async (next: LiveRuntimeSnapshot) => {
      snapshot = structuredClone(next)
      return ++revision
    }),
    updateConfiguration: vi.fn(async (next: LiveDocumentConfiguration) => {
      configuration = structuredClone(next)
      return ++revision
    }),
    dump: vi.fn(async (path: string) => writeFile(path, "archive")),
    terminate: vi.fn(async () => undefined)
  }
  const service = new LiveDocumentService(root, () => worker as unknown as LiveWorkerClient)
  await service.prepareCreate(configuration, join(root, "Stage.hrl"))
  service.commitCandidate()
  return { service, worker, root, next: { ...configuration, name: "New stage" } }
}

describe("Live commit outcome reconciliation", () => {
  it("recognizes a committed baseline after losing the reply and retains undo/redo", async () => {
    const { service, worker } = await fixture()
    const original = (await service.baseline()).snapshot
    const next = structuredClone(original)
    next.graph.channels[0]!.gainDb = -6
    const commit = worker.replaceBaseline.getMockImplementation()!
    worker.replaceBaseline.mockImplementationOnce(async (value) => {
      await commit(value)
      throw new Error("reply lost")
    })
    // The database may return rows in a different order.
    worker.mixerSnapshot.mockResolvedValueOnce(original.graph).mockResolvedValueOnce({
      ...next.graph,
      channels: [...next.graph.channels].reverse()
    })
    expect(await service.commitCapture(next, 0)).toBe(1)
    expect(service.current?.dirty).toBe(true)
    expect(service.history).toEqual({ canUndo: true, canRedo: false })
    expect((await service.undoEdit(1)).snapshot).toEqual(original)
    expect((await service.redoEdit(2)).snapshot).toEqual(next)
    await service.shutdown()
  })

  it.each(["unchanged", "unreadable", "advanced", "different"] as const)(
    "does not acknowledge a baseline when the result is %s",
    async (outcome) => {
      const { service, worker } = await fixture()
      const baseline = await service.baseline()
      const next = structuredClone(baseline.snapshot)
      next.graph.channels[0]!.gainDb = -6
      const failure = new Error("reply lost")
      worker.replaceBaseline.mockRejectedValueOnce(failure)
      if (outcome === "unreadable") worker.revision.mockRejectedValueOnce(new Error("offline"))
      else
        worker.revision.mockResolvedValueOnce(
          outcome === "advanced" ? 2 : outcome === "different" ? 1 : 0
        )
      const operation = service.commitCapture(next, 0)
      if (outcome === "unchanged") await expect(operation).rejects.toBe(failure)
      else await expect(operation).rejects.toMatchObject({ code: "operation-outcome-unknown" })
      expect(service.current?.dirty).toBe(false)
      expect(service.history).toEqual({ canUndo: false, canRedo: false })
      expect((await service.baseline()).revision).toBe(0)
      await service.shutdown()
    }
  )

  it("recognizes committed configuration after a lost reply, then undoes it", async () => {
    const { service, worker, next } = await fixture()
    const initial = service.current!.configuration
    const commit = worker.updateConfiguration.getMockImplementation()!
    worker.updateConfiguration.mockImplementationOnce(async (value) => {
      await commit(value)
      throw new Error("reply lost")
    })
    await expect(service.updateConfiguration(next, 0)).resolves.toMatchObject({
      configuration: next,
      dirty: true
    })
    await service.undoEdit(1)
    expect(service.current?.configuration).toEqual(initial)
    await service.redoEdit(2)
    expect(service.current?.configuration).toEqual(next)
    await expect(service.updateConfiguration(initial, 0)).rejects.toThrow("revision changed")
    expect(service.current?.configuration).toEqual(next)
    await service.shutdown()
  })

  it.each(["unchanged", "unreadable", "advanced", "different"] as const)(
    "does not acknowledge configuration when the result is %s",
    async (outcome) => {
      const { service, worker, next } = await fixture()
      const initial = service.current
      const failure = new Error("reply lost")
      worker.updateConfiguration.mockRejectedValueOnce(failure)
      if (outcome === "unreadable") worker.revision.mockRejectedValueOnce(new Error("offline"))
      else
        worker.revision.mockResolvedValueOnce(
          outcome === "advanced" ? 2 : outcome === "different" ? 1 : 0
        )
      const operation = service.updateConfiguration(next, 0)
      if (outcome === "unchanged") await expect(operation).rejects.toBe(failure)
      else await expect(operation).rejects.toMatchObject({ code: "operation-outcome-unknown" })
      expect(service.current).toEqual(initial)
      expect(service.history).toEqual({ canUndo: false, canRedo: false })
      await service.shutdown()
    }
  )

  it("retains the active dirty document if saving fails, and cancellation preserves it", async () => {
    const { service, worker, next } = await fixture()
    await service.updateConfiguration(next, 0)
    worker.dump.mockRejectedValueOnce(new Error("disk full"))
    await expect(service.close("save")).rejects.toThrow("disk full")
    expect(service.current?.dirty).toBe(true)
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(await service.close("cancel")).toBe(false)
    expect(service.current?.configuration).toEqual(next)
    expect(await service.close("save")).toBe(true)
    expect(service.current).toBeNull()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(await service.close("discard")).toBe(true)
  })
})
