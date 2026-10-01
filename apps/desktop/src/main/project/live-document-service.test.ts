import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  LiveDocumentConfiguration,
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
