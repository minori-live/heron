import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(() => []),
  fromWebContents: vi.fn(),
  getPath: vi.fn(() => "/tmp/heron-test"),
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
  shellOpenPath: vi.fn(),
  quit: vi.fn(),
  showAboutPanel: vi.fn()
}))

vi.mock("electron", () => ({
  app: {
    getPath: electronMocks.getPath,
    quit: electronMocks.quit,
    showAboutPanel: electronMocks.showAboutPanel
  },
  ipcMain: { handle: electronMocks.handle },
  dialog: {
    showSaveDialog: electronMocks.showSaveDialog,
    showOpenDialog: electronMocks.showOpenDialog
  },
  shell: { openPath: electronMocks.shellOpenPath },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    fromWebContents: electronMocks.fromWebContents
  }
}))

import { IPC_CHANNELS } from "@heron/contracts"
import type { TransportSnapshot } from "@heron/contracts"
import { createContext, invoke, meta, mutationMeta } from "./test-harness"
import { registerLowLatencyHandlers } from "./low-latency-handlers"

const runtime = {
  state: "running" as const,
  requestedBufferSize: 256,
  sampleRate: 48_000,
  inputSampleRate: 48_000,
  outputSampleRate: 48_000,
  inputBufferSize: 256,
  outputBufferSize: 256,
  ringBufferCapacityFrames: 1_024,
  ringBufferFillFrames: 0,
  inputLatencyMs: 1,
  outputLatencyMs: 1,
  ringBufferLatencyMs: 1,
  engineLatencyMs: 1,
  estimatedRoundTripLatencyMs: 3,
  xruns: 0,
  clockSync: "shared-device" as const,
  bufferFallback: false
}

const snapshot = {
  enabled: true,
  targetOutputChannelId: "master",
  pluginBudgetMs: 2,
  hasMonitoringPath: true,
  bypassedPluginInstanceIds: [],
  effectiveBudgetSamples: 96,
  unavoidableLatencySamples: 0
}

describe("registerLowLatencyHandlers", () => {
  beforeEach(() => electronMocks.handle.mockReset())

  it("reads a snapshot only through the current engine generation", async () => {
    const context = createContext()
    context.projectGraph.lowLatencySnapshot = vi.fn(async () => snapshot)
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    registerLowLatencyHandlers(context)

    await expect(
      invoke(electronMocks, IPC_CHANNELS.lowLatencyModeSnapshot, meta({ target: audio.engine! }))
    ).resolves.toMatchObject({ ok: true, value: snapshot, resourceRevision: audio.revision })
    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeSnapshot,
        meta({ target: { ...audio.engine!, generation: 99 } })
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-resource" } })
  })

  it("rejects snapshots after project close has taken ownership", async () => {
    const context = createContext()
    const readSnapshot = vi.fn(async () => snapshot)
    context.projectGraph.lowLatencySnapshot = readSnapshot
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    context.lifecycle.beginProject("closing")
    registerLowLatencyHandlers(context)

    await expect(
      invoke(electronMocks, IPC_CHANNELS.lowLatencyModeSnapshot, meta({ target: audio.engine! }))
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-resource" } })
    expect(readSnapshot).not.toHaveBeenCalled()
  })

  it("keeps snapshots and configure available while the project is saving", async () => {
    const context = createContext()
    const readSnapshot = vi.fn(async () => snapshot)
    const configure = vi.fn(async () => snapshot)
    context.projectGraph.lowLatencySnapshot = readSnapshot
    context.projectGraph.configureLowLatencyMode = configure
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    context.lifecycle.beginProject("saving")
    registerLowLatencyHandlers(context)

    await expect(
      invoke(electronMocks, IPC_CHANNELS.lowLatencyModeSnapshot, meta({ target: audio.engine! }))
    ).resolves.toMatchObject({ ok: true, value: snapshot })
    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeConfigure,
        mutationMeta(audio.engine!, {
          expectedRevision: audio.revision,
          mutation: { operationId: "saving", idempotencyKey: "saving" }
        }),
        { enabled: true }
      )
    ).resolves.toMatchObject({ ok: true, value: snapshot })
    expect(readSnapshot).toHaveBeenCalledOnce()
    expect(configure).toHaveBeenCalledOnce()
  })

  it("rejects fresh configure after close ownership without registering work", async () => {
    const context = createContext()
    const configure = vi.fn(async () => snapshot)
    context.projectGraph.configureLowLatencyMode = configure
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    context.lifecycle.beginProject("closing")
    registerLowLatencyHandlers(context)
    const request = mutationMeta(audio.engine!, {
      expectedRevision: audio.revision,
      mutation: { operationId: "closing", idempotencyKey: "closing" }
    })

    await expect(
      invoke(electronMocks, IPC_CHANNELS.lowLatencyModeConfigure, request, { enabled: true })
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-resource" } })
    expect(context.transport.snapshot).not.toHaveBeenCalled()
    expect(configure).not.toHaveBeenCalled()
    expect(context.operations.registry.status("closing").ok).toBe(false)
  })

  it("validates the mutation envelope and bounded configuration", async () => {
    const context = createContext()
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    registerLowLatencyHandlers(context)

    for (const value of [
      null,
      [],
      { enabled: "yes" },
      { targetOutputChannelId: "" },
      { pluginBudgetMs: 51 }
    ]) {
      await expect(
        invoke(
          electronMocks,
          IPC_CHANNELS.lowLatencyModeConfigure,
          meta({ target: audio.engine! }),
          value
        )
      ).resolves.toMatchObject({ ok: false, error: { code: "validation-failed" } })
    }
  })

  it("rejects conflicts and active transport before committing", async () => {
    const context = createContext()
    context.projectGraph.configureLowLatencyMode = vi.fn(async () => snapshot)
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    registerLowLatencyHandlers(context)

    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeConfigure,
        mutationMeta(audio.engine!, { expectedRevision: audio.revision + 1 }),
        { enabled: true }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "revision-conflict" } })

    vi.mocked(context.transport.snapshot).mockResolvedValueOnce({
      state: "playing",
      positionFrames: 10,
      sampleRate: 48_000
    } as never)
    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeConfigure,
        mutationMeta(audio.engine!, {
          expectedRevision: audio.revision,
          mutation: { operationId: "playing", idempotencyKey: "playing" }
        }),
        { pluginBudgetMs: 4 }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "validation-failed" } })
  })

  it("replays an identity-matching configure result after close takes ownership", async () => {
    const context = createContext()
    const configure = vi.fn(async () => snapshot)
    context.projectGraph.configureLowLatencyMode = configure
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    registerLowLatencyHandlers(context)
    const request = mutationMeta(audio.engine!, {
      expectedRevision: audio.revision,
      mutation: { operationId: "replay-closing", idempotencyKey: "replay-closing" }
    })

    await expect(
      invoke(electronMocks, IPC_CHANNELS.lowLatencyModeConfigure, request, { enabled: true })
    ).resolves.toMatchObject({ ok: true, value: snapshot })
    context.lifecycle.beginProject("closing")
    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeConfigure,
        { ...request, requestId: "replay-after-close" },
        { enabled: true }
      )
    ).resolves.toMatchObject({ ok: true, requestId: "replay-after-close", value: snapshot })
    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeConfigure,
        { ...request, requestId: "replay-before-fresh-validation", expectedRevision: undefined },
        null
      )
    ).resolves.toMatchObject({
      ok: true,
      requestId: "replay-before-fresh-validation",
      value: snapshot
    })
    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeConfigure,
        {
          ...request,
          requestId: "wrong-generation",
          target: { ...audio.engine!, generation: audio.engine!.generation + 1 }
        },
        { enabled: true }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "validation-failed" } })
    expect(configure).toHaveBeenCalledOnce()
    expect(context.operations.registry.retainedTerminalCount).toBe(1)
  })

  it("holds close drain until an admitted configure reaches a terminal result", async () => {
    const context = createContext()
    let resolveTransport!: () => void
    context.transport.snapshot = vi.fn(
      () =>
        new Promise<TransportSnapshot>((resolve) => {
          resolveTransport = () =>
            resolve({
              state: "stopped",
              positionFrames: 0,
              sampleRate: 48_000,
              loopEnabled: false,
              loopRange: null
            })
        })
    )
    context.projectGraph.configureLowLatencyMode = vi.fn(async () => snapshot)
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    registerLowLatencyHandlers(context)
    const request = mutationMeta(audio.engine!, {
      expectedRevision: audio.revision,
      mutation: { operationId: "admitted", idempotencyKey: "admitted" }
    })

    const configuring = invoke(electronMocks, IPC_CHANNELS.lowLatencyModeConfigure, request, {
      enabled: true
    })
    await vi.waitFor(() => expect(context.transport.snapshot).toHaveBeenCalledOnce())
    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeConfigure,
        { ...request, requestId: "running-duplicate" },
        { enabled: true }
      )
    ).resolves.toMatchObject({
      ok: false,
      requestId: "running-duplicate",
      error: { code: "resource-busy" }
    })
    expect(context.transport.snapshot).toHaveBeenCalledOnce()
    context.lifecycle.beginProject("closing")
    let drained = false
    const draining = context.lifecycle.settleProjectWork().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    resolveTransport()
    await expect(configuring).resolves.toMatchObject({ ok: true, value: snapshot })
    await draining
    expect(context.operations.registry.status("admitted")).toMatchObject({
      ok: true,
      value: { state: "committed", result: { ok: true } }
    })
    expect(drained).toBe(true)
  })

  it("serializes distinct configure preflights before revision and graph publication", async () => {
    const context = createContext()
    let releaseFirstTransport!: () => void
    const firstTransport = new Promise<TransportSnapshot>((resolve) => {
      releaseFirstTransport = () =>
        resolve({
          state: "stopped",
          positionFrames: 0,
          sampleRate: 48_000,
          loopEnabled: false,
          loopRange: null
        })
    })
    const alreadyResolvedSecondTransport = Promise.resolve<TransportSnapshot>({
      state: "stopped",
      positionFrames: 0,
      sampleRate: 48_000,
      loopEnabled: false,
      loopRange: null
    })
    context.transport.snapshot = vi
      .fn()
      .mockReturnValueOnce(firstTransport)
      .mockReturnValueOnce(alreadyResolvedSecondTransport)
    const configure = vi.fn(async () => snapshot)
    context.projectGraph.configureLowLatencyMode = configure
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    registerLowLatencyHandlers(context)
    const firstRequest = mutationMeta(audio.engine!, {
      expectedRevision: audio.revision,
      mutation: { operationId: "ordered-a", idempotencyKey: "ordered-a" }
    })
    const secondRequest = mutationMeta(audio.engine!, {
      expectedRevision: audio.revision,
      mutation: { operationId: "ordered-b", idempotencyKey: "ordered-b" }
    })

    const first = invoke(electronMocks, IPC_CHANNELS.lowLatencyModeConfigure, firstRequest, {
      enabled: true
    })
    await vi.waitFor(() => expect(context.transport.snapshot).toHaveBeenCalledOnce())
    const second = invoke(electronMocks, IPC_CHANNELS.lowLatencyModeConfigure, secondRequest, {
      pluginBudgetMs: 9
    })
    await Promise.resolve()
    expect(context.transport.snapshot).toHaveBeenCalledOnce()
    expect(configure).not.toHaveBeenCalled()

    releaseFirstTransport()
    await expect(first).resolves.toMatchObject({
      ok: true,
      value: snapshot,
      resourceRevision: audio.revision + 1
    })
    await expect(second).resolves.toMatchObject({
      ok: false,
      error: {
        code: "revision-conflict",
        details: { expectedRevision: audio.revision, actualRevision: audio.revision + 1 }
      }
    })

    expect(context.transport.snapshot).toHaveBeenCalledOnce()
    expect(configure).toHaveBeenCalledOnce()
    expect(configure).toHaveBeenCalledWith({ enabled: true })
    expect(context.operations.registry.status("ordered-a")).toMatchObject({
      ok: true,
      value: { state: "committed" }
    })
    expect(context.operations.registry.status("ordered-b")).toMatchObject({
      ok: true,
      value: { state: "not-committed" }
    })
    expect(context.lifecycle.applicationState.resources.resolve(audio.engine!)).toMatchObject({
      ok: true,
      value: { revision: audio.revision + 1 }
    })
  })

  it("commits, rebinds duplicate results, and classifies thrown failures", async () => {
    const context = createContext()
    const configure = vi.fn().mockResolvedValueOnce(snapshot)
    context.projectGraph.configureLowLatencyMode = configure
    const audio = await context.lifecycle.applicationState.commitAudioEngine(runtime)
    registerLowLatencyHandlers(context)
    const request = mutationMeta(audio.engine!, {
      expectedRevision: audio.revision,
      mutation: { operationId: "configure", idempotencyKey: "configure" }
    })

    await expect(
      invoke(electronMocks, IPC_CHANNELS.lowLatencyModeConfigure, request, { enabled: true })
    ).resolves.toMatchObject({ ok: true, value: snapshot })
    await expect(
      invoke(
        electronMocks,
        IPC_CHANNELS.lowLatencyModeConfigure,
        { ...request, requestId: "duplicate" },
        { enabled: true }
      )
    ).resolves.toMatchObject({ ok: true, requestId: "duplicate" })
    expect(configure).toHaveBeenCalledOnce()

    const contextWithFailure = createContext()
    contextWithFailure.projectGraph.configureLowLatencyMode = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("invalid"))
      .mockRejectedValueOnce(new Error("native failure"))
    const failedAudio =
      await contextWithFailure.lifecycle.applicationState.commitAudioEngine(runtime)
    electronMocks.handle.mockReset()
    registerLowLatencyHandlers(contextWithFailure)
    for (const [operationId, code] of [
      ["invalid", "validation-failed"],
      ["native", "operation-timeout-unknown"]
    ] as const) {
      await expect(
        invoke(
          electronMocks,
          IPC_CHANNELS.lowLatencyModeConfigure,
          mutationMeta(failedAudio.engine!, {
            expectedRevision: failedAudio.revision,
            mutation: { operationId, idempotencyKey: operationId }
          }),
          { enabled: true }
        )
      ).resolves.toMatchObject({ ok: false, error: { code } })
    }
  })
})
