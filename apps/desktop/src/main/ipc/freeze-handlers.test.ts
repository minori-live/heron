import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  showSaveDialog: vi.fn(),
  getAllWindows: vi.fn(() => [])
}))
vi.mock("@heron/dsp-node", () => ({
  AudioHostRuntime: class {},
  analyzeWaveform: vi.fn(),
  finalizeRecording: vi.fn(),
  importAudioFile: vi.fn(),
  parseMidiData: vi.fn(),
  parseMidiFile: vi.fn(),
  recoverMidiJournalTake: vi.fn(),
  repairRecordingHeader: vi.fn(),
  writeDeterministicTestRecording: vi.fn()
}))
vi.mock("electron", () => ({
  app: { isPackaged: false },
  ipcMain: { handle: electronMocks.handle },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows }
}))

import { IPC_CHANNELS } from "@heron/contracts"
import type { MixerChannelState, ProjectGraphSnapshot } from "@heron/contracts"
import type { AudioHostTrackFreezeStatus } from "../audio-host"
import {
  createContext,
  createWorkspace,
  emptyGraph,
  installWorkspace,
  invoke,
  mutationMeta
} from "./test-harness"
import { registerFreezeHandlers } from "./freeze-handlers"

const audio: MixerChannelState = {
  ...emptyGraph.channels[0]!,
  id: "audio",
  kind: "audio",
  name: "Vocal",
  outputChannelId: "master"
}

function freezeGraph(
  systemRole: MixerChannelState["systemRole"] = null,
  withClip = true
): ProjectGraphSnapshot {
  return {
    ...emptyGraph,
    tracks: [{ id: "track-vocal", channelId: audio.id, sortOrder: 0, freezeMode: "pre-fader" }],
    channels: [{ ...audio, systemRole }, emptyGraph.channels[0]!],
    audioClips: withClip
      ? [
          {
            id: "clip-1",
            assetId: "asset-1",
            trackId: "track-vocal",
            name: "Vocal",
            startFrame: 0,
            sourceOffsetFrames: 0,
            lengthFrames: 256,
            sourceLengthFrames: 256,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            assetSampleRate: 48_000,
            assetChannels: 2
          }
        ]
      : []
  }
}

function status(
  state: AudioHostTrackFreezeStatus["state"],
  error: string | null = null
): AudioHostTrackFreezeStatus {
  return {
    operation_id: "op-1",
    state,
    phase: state === "running" ? "rendering" : "preparing",
    completed_units: state === "running" ? 10 : 256,
    total_units: 256,
    rendered_frames: 256,
    tail_frames: 0,
    latency_samples: 0,
    tail_truncated: false,
    error
  }
}

function installHost(
  context: ReturnType<typeof createContext>,
  graph: ProjectGraphSnapshot,
  host: Record<string, unknown>
) {
  const workspace = installWorkspace(context.lifecycle, createWorkspace({ graph }))
  Object.assign(context.audioHost, host)
  vi.mocked(context.projectGraph.snapshot).mockResolvedValue(graph)
  Object.assign(context.projectGraph, {
    compileTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 }))
  })
  return workspace
}

describe("registerFreezeHandlers", () => {
  beforeEach(() => {
    electronMocks.handle.mockReset()
  })

  it("rejects a freeze before the offline render starts", async () => {
    const context = createContext()
    registerFreezeHandlers(context)
    expect(
      await invoke(
        electronMocks as never,
        IPC_CHANNELS.trackFreezeStart,
        mutationMeta({ kind: "project-graph", id: "missing", epoch: "epoch", generation: 1 }),
        { trackId: "track-vocal" }
      )
    ).toMatchObject({ ok: false })

    const empty = installWorkspace(
      context.lifecycle,
      createWorkspace({ graph: freezeGraph(null, false) })
    )
    expect(
      await invoke(
        electronMocks as never,
        IPC_CHANNELS.trackFreezeStart,
        mutationMeta(empty.projectGraph, { expectedRevision: empty.revision }),
        {}
      )
    ).toMatchObject({ ok: false })
    expect(
      await invoke(
        electronMocks as never,
        IPC_CHANNELS.trackFreezeStart,
        mutationMeta(empty.projectGraph, { expectedRevision: empty.revision }),
        { trackId: "track-vocal" }
      )
    ).toMatchObject({ ok: false })

    context.lifecycle.beginExclusiveOfflineOperation("bounce")
    expect(
      await invoke(
        electronMocks as never,
        IPC_CHANNELS.trackFreezeStart,
        mutationMeta(empty.projectGraph, { expectedRevision: empty.revision }),
        { trackId: "track-vocal" }
      )
    ).toMatchObject({ ok: false })
  })

  it("commits the imported freeze after restoring a running engine", async () => {
    const context = createContext()
    const graph = freezeGraph()
    const renderGraph = { sample_rate: 48_000, plugins: [] }
    const workspace = installHost(context, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "running", sampleRate: 48_000 })),
      stopAudioEngine: vi.fn(async () => undefined),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => renderGraph),
      startTrackFreeze: vi.fn(async () => status("running")),
      trackFreezeStatus: vi.fn(async () => ({ ...status("completed"), tail_truncated: true })),
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    context.transport.snapshot = vi.fn(async () => ({
      state: "playing" as const,
      positionFrames: 32,
      sampleRate: 48_000,
      loopEnabled: true,
      loopRange: { startTick: 0, endTick: 960 }
    }))
    Object.assign(context.projectGraph, {
      compileTrackFreezeSource: vi.fn(async () => renderGraph)
    })
    Object.assign(context.projectCommands, {
      currentWorkspace: () => workspace,
      execute: vi.fn(async () => ({
        ok: true,
        value: {
          graph,
          inverse: { type: "set-track-freeze", trackId: "track-vocal", freeze: null }
        },
        resourceRevision: 2
      }))
    })
    context.audioImport.import = vi.fn(async () => ({
      selectedAssetIds: ["freeze-asset"],
      importedAssetIds: ["freeze-asset"]
    }))
    registerFreezeHandlers(context)

    const result = await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(workspace.projectGraph, { expectedRevision: workspace.revision }),
      { trackId: "track-vocal" }
    )
    expect(result).toMatchObject({ ok: true, value: { operationId: "op-1" } })
    await vi.waitFor(() => {
      expect(context.operations.operationStatus("op-1")?.state).toBe("committed")
    })
    expect(context.audioHost.deployTrackFreezeSource).toHaveBeenCalledWith(graph, renderGraph)
    expect(context.audioHost.startTrackFreeze).toHaveBeenCalledWith(
      expect.objectContaining({ channel_id: "audio", start_frame: 0, end_frame: 256 }),
      renderGraph
    )
    expect(context.audioHost.restartAfterOfflineBounce).toHaveBeenCalledWith(true)
    expect(context.transport.command).toHaveBeenCalledWith({ type: "seek", positionFrames: 32 })
    expect(context.projectCommands.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "set-track-freeze",
        freeze: expect.objectContaining({ assetId: "freeze-asset", status: "frozen" })
      })
    )
  })

  it("cancels an in-flight render and reports a failed restart", async () => {
    const context = createContext()
    const graph = freezeGraph()
    const workspace = installHost(context, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "stopped", sampleRate: 48_000 })),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 })),
      startTrackFreeze: vi.fn(async () => status("running")),
      trackFreezeStatus: vi
        .fn()
        .mockImplementationOnce(async () => {
          await context.operations.cancel("op-1")
          return status("running")
        })
        .mockResolvedValueOnce(status("running"))
        .mockResolvedValue(status("cancelled", "track freeze cancelled")),
      cancelTrackFreeze: vi.fn(async () => undefined),
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    registerFreezeHandlers(context)
    await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(workspace.projectGraph, { expectedRevision: workspace.revision }),
      { trackId: "track-vocal" }
    )
    await vi.waitFor(() => {
      expect(context.operations.operationStatus("op-1")).toMatchObject({
        state: "not-committed",
        result: { ok: false, error: { code: "operation-cancelled" } }
      })
    })
    expect(context.audioHost.cancelTrackFreeze).toHaveBeenCalledWith("op-1")
  })

  it("reports a failed restart after the render stops", async () => {
    const failed = createContext()
    const graph = freezeGraph()
    const failedWorkspace = installHost(failed, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "running", sampleRate: 48_000 })),
      stopAudioEngine: vi.fn(async () => undefined),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 })),
      startTrackFreeze: vi.fn(async () => status("running")),
      trackFreezeStatus: vi.fn(async () => status("failed", "render failed")),
      restartAfterOfflineBounce: vi.fn(async () => {
        throw new Error("restart failed")
      })
    })
    failed.transport.snapshot = vi.fn(async () => ({
      state: "playing" as const,
      positionFrames: 0,
      sampleRate: 48_000,
      loopEnabled: false,
      loopRange: null
    }))
    registerFreezeHandlers(failed)
    await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(failedWorkspace.projectGraph, { expectedRevision: failedWorkspace.revision }),
      { trackId: "track-vocal" }
    )
    await vi.waitFor(() => {
      expect(failed.operations.operationStatus("op-1")).toMatchObject({
        state: "not-committed",
        result: { ok: false, error: { code: "resource-unavailable" } }
      })
    })
  })

  it("rejects a system track", async () => {
    const blocked = createContext()
    const system = installWorkspace(
      blocked.lifecycle,
      createWorkspace({ graph: freezeGraph("metronome") })
    )
    registerFreezeHandlers(blocked)
    expect(
      await invoke(
        electronMocks as never,
        IPC_CHANNELS.trackFreezeStart,
        mutationMeta(system.projectGraph, { expectedRevision: system.revision }),
        { trackId: "track-vocal" }
      )
    ).toMatchObject({ ok: false })
  })

  it("rejects a missing track and a busy host", async () => {
    const busy = createContext()
    const workspace = installHost(busy, freezeGraph(), {
      audioEngineSnapshot: vi.fn(async () => ({ state: "stopped", sampleRate: 48_000 }))
    })
    registerFreezeHandlers(busy)
    expect(
      await invoke(
        electronMocks as never,
        IPC_CHANNELS.trackFreezeStart,
        mutationMeta(workspace.projectGraph, { expectedRevision: workspace.revision }),
        { trackId: "missing" }
      )
    ).toMatchObject({ ok: false })

    busy.operations.registry.begin({
      operationId: "other",
      idempotencyKey: "other",
      target: workspace.projectGraph
    })
    expect(
      await invoke(
        electronMocks as never,
        IPC_CHANNELS.trackFreezeStart,
        mutationMeta(workspace.projectGraph, { expectedRevision: workspace.revision }),
        { trackId: "track-vocal" }
      )
    ).toMatchObject({ ok: false, error: { code: "resource-busy" } })
  })

  it("fails a render that stops before the freeze is committed", async () => {
    const failedImport = createContext()
    const importing = installHost(failedImport, freezeGraph(), {
      audioEngineSnapshot: vi.fn(async () => ({ state: "stopped", sampleRate: 48_000 })),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 })),
      startTrackFreeze: vi.fn(async () => status("running")),
      trackFreezeStatus: vi.fn(async () => status("failed", "render failed")),
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    registerFreezeHandlers(failedImport)
    await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(importing.projectGraph, { expectedRevision: importing.revision }),
      { trackId: "track-vocal" }
    )
    await vi.waitFor(() => {
      expect(failedImport.operations.operationStatus("op-1")).toMatchObject({
        state: "not-committed",
        result: { ok: false, error: { code: "resource-unavailable" } }
      })
    })
  })

  it("rejects an exclusive bounce, a duplicate operation, and a second freeze", async () => {
    const context = createContext()
    const graph = freezeGraph()
    const workspace = installHost(context, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "stopped", sampleRate: 48_000 })),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 })),
      startTrackFreeze: vi.fn(async () => status("running")),
      trackFreezeStatus: vi.fn(async () => status("running"))
    })
    registerFreezeHandlers(context)
    const meta = mutationMeta(workspace.projectGraph, { expectedRevision: workspace.revision })
    context.lifecycle.beginExclusiveOfflineOperation("bounce")
    expect(
      await invoke(electronMocks as never, IPC_CHANNELS.trackFreezeStart, meta, {
        trackId: "track-vocal"
      })
    ).toMatchObject({ ok: false })
    context.lifecycle.endExclusiveOfflineOperation("bounce")

    vi.spyOn(context.operations.registry, "begin").mockReturnValueOnce({
      ok: false,
      error: { code: "operation-busy" }
    } as never)
    expect(
      await invoke(electronMocks as never, IPC_CHANNELS.trackFreezeStart, meta, {
        trackId: "track-vocal"
      })
    ).toMatchObject({ ok: false })

    const running = await invoke(electronMocks as never, IPC_CHANNELS.trackFreezeStart, meta, {
      trackId: "track-vocal"
    })
    expect(running).toMatchObject({ ok: true, value: { operationId: "op-1" } })
    expect(
      await invoke(
        electronMocks as never,
        IPC_CHANNELS.trackFreezeStart,
        mutationMeta(workspace.projectGraph, {
          expectedRevision: workspace.revision,
          mutation: { operationId: "op-2", idempotencyKey: "idem-2" }
        }),
        { trackId: "track-vocal" }
      )
    ).toMatchObject({
      ok: false,
      error: { code: "resource-busy", details: { activeOperationId: "op-1" } }
    })
    vi.mocked(context.audioHost.trackFreezeStatus).mockResolvedValue(
      status("cancelled", "track freeze cancelled")
    )
    Object.assign(context.audioHost, {
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    await vi.waitFor(() => {
      expect(context.operations.operationStatus("op-1")?.state).toBe("not-committed")
    })
  })

  it("fails when plugin sync removes the track being frozen", async () => {
    const missingSource = createContext()
    const graph = freezeGraph()
    const missingWorkspace = installHost(missingSource, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "stopped", sampleRate: 48_000 })),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(),
      deployTrackFreezeSource: vi.fn(),
      startTrackFreeze: vi.fn(),
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    vi.mocked(missingSource.projectGraph.snapshot).mockResolvedValue({ ...graph, tracks: [] })
    registerFreezeHandlers(missingSource)
    await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(missingWorkspace.projectGraph, {
        expectedRevision: missingWorkspace.revision
      }),
      { trackId: "track-vocal" }
    )
    await vi.waitFor(() => {
      expect(missingSource.operations.operationStatus("op-1")?.state).toBe("not-committed")
    })
    expect(missingSource.audioHost.deployTrackFreezeSource).not.toHaveBeenCalled()
  })

  it("fails when the rendered file is not imported", async () => {
    const emptyImport = createContext()
    const graph = freezeGraph()
    const importWorkspace = installHost(emptyImport, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "stopped", sampleRate: 48_000 })),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 })),
      startTrackFreeze: vi.fn(async () => status("completed")),
      trackFreezeStatus: vi.fn(async () => status("completed")),
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    emptyImport.audioImport.import = vi.fn(async () => ({
      selectedAssetIds: [],
      importedAssetIds: []
    }))
    registerFreezeHandlers(emptyImport)
    await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(importWorkspace.projectGraph, { expectedRevision: importWorkspace.revision }),
      { trackId: "track-vocal" }
    )
    await vi.waitFor(() => {
      expect(emptyImport.operations.operationStatus("op-1")).toMatchObject({
        state: "not-committed",
        result: { ok: false, error: { code: "resource-unavailable" } }
      })
    })
  })

  it("deletes the imported asset when the freeze commit is rejected", async () => {
    const rejected = createContext()
    const graph = freezeGraph()
    const rejectedWorkspace = installHost(rejected, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "stopped", sampleRate: 48_000 })),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 })),
      startTrackFreeze: vi.fn(async () => ({
        ...status("completed"),
        rendered_frames: null,
        tail_truncated: true
      })),
      trackFreezeStatus: vi.fn(async () => ({
        ...status("completed"),
        rendered_frames: null,
        tail_truncated: true
      })),
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    Object.assign(rejected.projectCommands, {
      currentWorkspace: () => rejectedWorkspace,
      execute: vi.fn(async () => ({
        ok: false,
        error: { userMessageKey: "errors.commit" }
      }))
    })
    rejected.audioImport.import = vi.fn(async () => ({
      selectedAssetIds: ["freeze-asset"],
      importedAssetIds: ["freeze-asset"]
    }))
    const deleteAssets = vi.fn(async () => undefined)
    Object.assign(rejected.projects, { deleteAssets })
    registerFreezeHandlers(rejected)
    await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(rejectedWorkspace.projectGraph, {
        expectedRevision: rejectedWorkspace.revision
      }),
      { trackId: "track-vocal" }
    )
    await vi.waitFor(() => {
      expect(deleteAssets).toHaveBeenCalledWith(["freeze-asset"])
    })
    expect(rejected.projectCommands.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        freeze: expect.objectContaining({ lengthFrames: 256 })
      })
    )
    expect(rejected.operations.operationStatus("op-1")).toMatchObject({
      state: "not-committed",
      result: { ok: false, error: { code: "resource-unavailable" } }
    })
  })

  it("reports failure when restoring the playhead throws", async () => {
    const context = createContext()
    const graph = freezeGraph()
    const workspace = installHost(context, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "running", sampleRate: 48_000 })),
      stopAudioEngine: vi.fn(async () => undefined),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 })),
      startTrackFreeze: vi.fn(async () => status("failed", "render failed")),
      trackFreezeStatus: vi.fn(async () => status("failed", "render failed")),
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    context.transport.snapshot = vi.fn(async () => ({
      state: "stopped" as const,
      positionFrames: 8,
      sampleRate: 48_000,
      loopEnabled: false,
      loopRange: null
    }))
    context.transport.command = vi.fn(async () => {
      throw new Error("seek failed")
    })
    registerFreezeHandlers(context)
    await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(workspace.projectGraph, { expectedRevision: workspace.revision }),
      { trackId: "track-vocal" }
    )
    await vi.waitFor(() => {
      expect(context.operations.operationStatus("op-1")).toMatchObject({
        state: "not-committed",
        result: { ok: false, error: { code: "resource-unavailable" } }
      })
    })
    expect(context.transport.command).toHaveBeenCalled()
  })

  it("ignores a cancel status error and still records cancellation", async () => {
    const context = createContext()
    const graph = freezeGraph()
    const workspace = installHost(context, graph, {
      audioEngineSnapshot: vi.fn(async () => ({ state: "stopped", sampleRate: 48_000 })),
      refreshDesiredProjectGraph: vi.fn(),
      prepareOfflineBounce: vi.fn(async () => undefined),
      deployTrackFreezeSource: vi.fn(async () => ({ sample_rate: 48_000 })),
      startTrackFreeze: vi.fn(async () => status("running")),
      trackFreezeStatus: vi
        .fn()
        .mockImplementationOnce(async () => {
          await context.operations.cancel("op-1")
          return status("running")
        })
        .mockRejectedValueOnce(new Error("status unavailable"))
        .mockResolvedValue(status("cancelled", "track freeze cancelled")),
      cancelTrackFreeze: vi.fn(async () => undefined),
      restartAfterOfflineBounce: vi.fn(async () => undefined)
    })
    registerFreezeHandlers(context)
    await invoke(
      electronMocks as never,
      IPC_CHANNELS.trackFreezeStart,
      mutationMeta(workspace.projectGraph, { expectedRevision: workspace.revision }),
      { trackId: "track-vocal" }
    )
    await vi.waitFor(() => {
      expect(context.operations.operationStatus("op-1")).toMatchObject({
        state: "not-committed",
        result: { ok: false, error: { code: "operation-cancelled" } }
      })
    })
    expect(context.audioHost.cancelTrackFreeze).not.toHaveBeenCalled()
  })
})
