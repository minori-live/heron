import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  LiveDocumentConfiguration,
  LiveHierarchy,
  LiveRuntimeSnapshot,
  MixerGraphSnapshot
} from "@heron/contracts"
import { LiveDocumentService } from "./live-document-service"
import type { LiveWorkerClient } from "./live-worker-client"

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Live document lifecycle", () => {
  it("removes obsolete plugin parameters on delete and replacement and restores them on undo", async () => {
    const root = await mkdtemp(join(tmpdir(), "heron-live-parameters-"))
    roots.push(root)
    const locator = { format: "vst3" as const, artifactPath: "/effect.vst3", nativeId: "effect" }
    let snapshot: LiveRuntimeSnapshot = {
      graph: {
        sampleRate: 48_000,
        channels: (["audio", "master", "output"] as const).map((kind) => ({
          id: kind,
          kind,
          name: kind,
          color: "#4F8CFF",
          sortOrder: 0,
          inputSource: kind === "audio" ? "hardware" : null,
          inputFormat: kind === "audio" ? "stereo" : null,
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: kind === "audio" ? "output" : null,
          outputBus: null,
          inputMonitoring: false,
          inputChannels: kind === "audio" ? [1, 2] : [],
          hardwareOutputChannels: kind === "output" ? [1, 2] : []
        })),
        sends: [],
        plugins: [
          {
            id: "plugin",
            channelId: "audio",
            role: "insert",
            slotOrder: 0,
            locator,
            descriptor: {
              source: { kind: "external" },
              locator,
              name: "Effect",
              vendor: "Heron",
              version: "1",
              categories: ["Fx"],
              kind: "effect",
              architecture: "x86_64",
              buses: [],
              supportedAudioModes: ["stereo"],
              hasEditor: false,
              compatibility: "compatible",
              compatibilityReason: null
            },
            audioMode: "stereo",
            enabled: true,
            sidechainInputs: [],
            state: { version: 1, chunks: [] }
          }
        ]
      },
      parameterValues: [{ pluginId: "plugin", parameterKey: "cutoff", value: 0.4 }]
    }
    let revision = 0
    const replaceBaseline = vi.fn(
      async (next: LiveRuntimeSnapshot, _bindings: unknown, expected: number) => {
        expect(expected).toBe(revision)
        snapshot = structuredClone(next)
        return ++revision
      }
    )
    const worker = {
      create: vi.fn(async () => undefined),
      mixerSnapshot: vi.fn(async () => structuredClone(snapshot.graph)),
      pluginParameterValues: vi.fn(async () => structuredClone(snapshot.parameterValues)),
      midiBindings: vi.fn(async () => []),
      hierarchy: vi.fn(async () => ({ sets: [], patches: [] })),
      replaceBaseline,
      dump: vi.fn(async (path: string) => writeFile(path, JSON.stringify(snapshot))),
      terminate: vi.fn(async () => undefined)
    } as unknown as LiveWorkerClient
    const service = new LiveDocumentService(root, () => worker)
    await service.prepareCreate(
      { name: "Stage", sampleRate: 48_000, audio: null, enabledMidiDeviceIds: [] },
      join(root, "Stage.hrl")
    )
    service.commitCandidate()
    const original = structuredClone(snapshot)

    await service.executeEdit({ type: "delete-plugin", pluginId: "plugin" }, revision)
    expect(snapshot.parameterValues).toEqual([])
    await service.undoEdit(revision)
    expect(snapshot).toEqual(original)

    await service.executeEdit(
      { type: "replace-plugin", pluginId: "plugin", plugin: original.graph.plugins[0]! },
      revision
    )
    expect(snapshot.parameterValues).toEqual([])
    await service.undoEdit(revision)
    expect(snapshot).toEqual(original)

    await service.executeEdit({ type: "delete-channel", channelId: "audio" }, revision)
    expect(snapshot.graph.plugins).toEqual([])
    expect(snapshot.parameterValues).toEqual([])
    await service.undoEdit(revision)
    expect(snapshot).toEqual(original)
    expect(replaceBaseline).toHaveBeenCalledTimes(6)
    await service.shutdown()
  })

  it("creates a durable .hrl, retains a dirty working copy, saves and reopens", async () => {
    const root = await mkdtemp(join(tmpdir(), "heron-live-service-"))
    roots.push(root)
    const path = join(root, "Stage.hrl")
    const state = new Map<string, { configuration: LiveDocumentConfiguration; revision: number }>()
    const terminated = vi.fn()
    function workerFactory(): LiveWorkerClient {
      let dataDir = ""
      return {
        create: vi.fn(async (directory: string, configuration: LiveDocumentConfiguration) => {
          dataDir = directory
          state.set(dataDir, { configuration: structuredClone(configuration), revision: 0 })
        }),
        open: vi.fn(async (directory: string, archivePath?: string) => {
          dataDir = directory
          if (archivePath) state.set(dataDir, JSON.parse(await readFile(archivePath, "utf8")))
          if (!state.has(dataDir)) throw new Error("missing database")
        }),
        configuration: vi.fn(async () => structuredClone(state.get(dataDir)!.configuration)),
        updateConfiguration: vi.fn(
          async (configuration: LiveDocumentConfiguration, expected: number) => {
            const current = state.get(dataDir)!
            if (current.revision !== expected) throw new Error("stale revision")
            state.set(dataDir, {
              configuration: structuredClone(configuration),
              revision: expected + 1
            })
            return expected + 1
          }
        ),
        revision: vi.fn(async () => state.get(dataDir)!.revision),
        mixerSnapshot: vi.fn(
          async () =>
            ({
              sampleRate: 48_000,
              channels: [],
              sends: [],
              plugins: []
            }) satisfies MixerGraphSnapshot
        ),
        midiBindings: vi.fn(async () => []),
        hierarchy: vi.fn(async () => ({ sets: [], patches: [] })),
        pluginParameterValues: vi.fn(async () => []),
        dump: vi.fn(async (outputPath: string) =>
          writeFile(outputPath, JSON.stringify(state.get(dataDir)))
        ),
        close: vi.fn(async () => undefined),
        terminate: vi.fn(async () => {
          terminated()
        })
      } as unknown as LiveWorkerClient
    }
    const initial: LiveDocumentConfiguration = {
      name: "Stage",
      sampleRate: 48_000,
      audio: null,
      enabledMidiDeviceIds: []
    }
    const first = new LiveDocumentService(root, workerFactory)
    expect((await first.prepareCreate(initial, join(root, "Stage"))).path).toBe(path)
    expect((await stat(path)).size).toBeGreaterThan(0)
    first.commitCandidate()
    expect(first.history).toEqual({ canUndo: false, canRedo: false })
    const configured: LiveDocumentConfiguration = {
      ...initial,
      name: "Stage Renamed",
      enabledMidiDeviceIds: ["keyboard-1"]
    }
    expect(
      (await first.updateConfiguration({ ...configured, name: "  Stage Renamed  " }, 0)).dirty
    ).toBe(true)
    expect(first.history).toEqual({ canUndo: true, canRedo: false })
    expect((await first.undoEdit(1)).revision).toBe(2)
    expect(first.history).toEqual({ canUndo: false, canRedo: true })
    expect(first.current?.configuration).toEqual(initial)
    expect((await first.redoEdit(2)).revision).toBe(3)
    expect(first.history).toEqual({ canUndo: true, canRedo: false })
    expect(first.current?.configuration).toEqual(configured)
    await first.shutdown()

    const second = new LiveDocumentService(root, workerFactory)
    expect(await second.hasRecoverableWorkingCopy(path)).toBe(true)
    const recovered = await second.prepareOpen(path, true)
    expect(recovered).toMatchObject({
      recoveredWorkingCopy: true,
      dirty: true,
      configuration: configured
    })
    second.commitCandidate()
    expect((await second.save()).dirty).toBe(false)
    expect(await second.close("discard")).toBe(true)

    const third = new LiveDocumentService(root, workerFactory)
    expect((await third.prepareOpen(path, false)).configuration).toEqual(configured)
    await third.abortCandidate()
    expect(terminated).toHaveBeenCalledTimes(3)
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "heron-live-reconcile-"))
  roots.push(root)
  let revision = 0
  let hierarchy: LiveHierarchy = { sets: [], patches: [] }
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
    hierarchy: vi.fn(async () => structuredClone(hierarchy)),
    replaceBaseline: vi.fn(
      async (
        next: LiveRuntimeSnapshot,
        _bindings?: unknown,
        _revision?: number,
        layers?: LiveHierarchy
      ) => {
        snapshot = structuredClone(next)
        if (layers) hierarchy = structuredClone(layers)
        return ++revision
      }
    ),
    updateConfiguration: vi.fn(async (next: LiveDocumentConfiguration) => {
      configuration = structuredClone(next)
      snapshot.graph.sampleRate = next.sampleRate
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

  it("reconciles a lost layer commit reply and restores the hierarchy through undo/redo", async () => {
    const { service, worker } = await fixture()
    const commit = worker.replaceBaseline.getMockImplementation()!
    worker.replaceBaseline.mockImplementationOnce(async (...args) => {
      await commit(...args)
      throw new Error("reply lost")
    })
    const created = await service.executeEdit(
      { type: "create-set", setId: "set", name: "First set" },
      0
    )
    expect(created.hierarchy.sets).toEqual([
      { id: "set", name: "First set", sortOrder: 0, overrides: [] }
    ])
    expect(service.current?.dirty).toBe(true)
    expect((await service.undoEdit(1)).hierarchy).toEqual({ sets: [], patches: [] })
    expect((await service.redoEdit(2)).hierarchy).toEqual(created.hierarchy)
    const patch = await service.executeEdit(
      { type: "create-patch", patchId: "patch", setId: "set", name: "Verse" },
      3
    )
    const deleted = await service.executeEdit({ type: "delete-live-layer", layerId: "set" }, 4)
    expect(deleted.hierarchy).toEqual({ sets: [], patches: [] })
    expect((await service.undoEdit(5)).hierarchy).toEqual(patch.hierarchy)
    await service.shutdown()
  })

  it.each(["different", "unreadable"] as const)(
    "quarantines a committed layer result when its hierarchy is %s",
    async (outcome) => {
      const { service, worker } = await fixture()
      const commit = worker.replaceBaseline.getMockImplementation()!
      worker.replaceBaseline.mockImplementationOnce(async (...args) => {
        await commit(...args)
        if (outcome === "different")
          worker.hierarchy.mockResolvedValueOnce({ sets: [], patches: [] })
        else worker.hierarchy.mockRejectedValueOnce(new Error("storage unavailable"))
        throw new Error("reply lost")
      })
      await expect(
        service.executeEdit({ type: "create-set", setId: "set", name: "First set" }, 0)
      ).rejects.toMatchObject({ code: "operation-outcome-unknown" })
      expect(service.history).toEqual({ canUndo: false, canRedo: false })
      await service.shutdown()
    }
  )

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
      expect(service.current?.dirty).toBe(outcome !== "unchanged")
      if (outcome !== "unchanged")
        expect(await service.hasRecoverableWorkingCopy(service.current!.path)).toBe(true)
      expect(service.history).toEqual({ canUndo: false, canRedo: false })
      expect((await service.baseline()).revision).toBe(0)
      await service.shutdown()
    }
  )

  it.each(["revision-conflict", "validation-failed"] as const)(
    "does not reconcile a known rejected write as a committed mutation: %s",
    async (code) => {
      const { service, worker, next } = await fixture()
      const baseline = await service.baseline()
      const rejected = Object.assign(new Error("rejected before commit"), { code })
      worker.replaceBaseline.mockRejectedValueOnce(rejected)
      worker.revision.mockResolvedValue(1)
      await expect(service.commitCapture(baseline.snapshot, 0)).rejects.toBe(rejected)
      worker.updateConfiguration.mockRejectedValueOnce(rejected)
      await expect(service.updateConfiguration(next, 0)).rejects.toBe(rejected)
      expect(worker.revision).not.toHaveBeenCalled()
      expect(service.history).toEqual({ canUndo: false, canRedo: false })
      await service.shutdown()
    }
  )

  it("publishes the committed sample rate when undoing and redoing configuration", async () => {
    const { service, next } = await fixture()
    await service.updateConfiguration({ ...next, sampleRate: 96000 }, 0)
    expect((await service.undoEdit(1)).snapshot.graph.sampleRate).toBe(48000)
    expect(service.current?.configuration.sampleRate).toBe(48000)
    expect((await service.redoEdit(2)).snapshot.graph.sampleRate).toBe(96000)
    expect(service.current?.configuration.sampleRate).toBe(96000)
    await service.shutdown()
  })

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
      expect(service.current).toEqual({ ...initial, dirty: outcome !== "unchanged" })
      expect(service.history).toEqual({ canUndo: false, canRedo: false })
      await service.shutdown()
    }
  )

  it("preserves a quarantined working copy for recovery without saving its uncertain state", async () => {
    const { service, worker } = await fixture()
    const path = service.current!.path
    const dumps = worker.dump.mock.calls.length
    worker.replaceBaseline.mockRejectedValueOnce(new Error("reply lost"))
    worker.revision.mockRejectedValueOnce(new Error("worker unavailable"))
    await expect(
      service.executeEdit({ type: "create-set", setId: "set", name: "Set" }, 0)
    ).rejects.toMatchObject({ code: "operation-outcome-unknown" })
    expect(await service.hasRecoverableWorkingCopy(path)).toBe(true)
    expect(await service.close("preserve")).toBe(true)
    expect(service.current).toBeNull()
    expect(worker.dump).toHaveBeenCalledTimes(dumps)
    expect(await service.hasRecoverableWorkingCopy(path)).toBe(true)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

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
