import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcMainInvokeEvent } from "electron"
import {
  DEFAULT_PLUGIN_ANALYSIS_SETTINGS,
  IPC_CHANNELS,
  pluginDescriptorKey
} from "@heron/contracts"
import type {
  PluginAnalysisCommand,
  PluginAnalysisSnapshot,
  PluginCatalogSnapshot,
  PluginDescriptor,
  RpcRequestMeta,
  RpcResult
} from "@heron/contracts"

const electron = vi.hoisted(() => {
  class Window {
    static instances: Window[] = []
    destroyed = false
    maximized = false
    minimized = false
    webContents = {
      isDestroyed: () => this.destroyed,
      mainFrame: { url: "" },
      getURL: () => this.webContents.mainFrame.url,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
    constructor() {
      Window.instances.push(this)
    }
    on = vi.fn()
    once = vi.fn()
    show = vi.fn()
    focus = vi.fn()
    isDestroyed = () => this.destroyed
    isMaximized = () => this.maximized
    minimize = () => {
      this.minimized = true
    }
    maximize = () => {
      this.maximized = true
    }
    unmaximize = () => {
      this.maximized = false
    }
    destroy = () => {
      this.destroyed = true
    }
    async loadURL(url: string) {
      this.webContents.mainFrame.url = url
      await loadURL(url)
    }
  }
  const loadURL = vi.fn(async (_url: string) => {})
  return { Window, loadURL, handle: vi.fn() }
})

vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => "/tmp/heron-test" },
  BrowserWindow: electron.Window,
  ipcMain: { handle: electron.handle },
  nativeTheme: { shouldUseDarkColors: true },
  shell: {}
}))

import { registerPluginAnalysisHandlers } from "./plugin-analysis-handlers"
import { createContext, meta, mutationMeta, trustedEvent } from "./test-harness"

const descriptor: PluginDescriptor = {
  source: { kind: "external" },
  locator: { format: "clap", artifactPath: "/plugins/Gain.clap", nativeId: "org.heron.gain" },
  name: "Gain",
  vendor: "Heron",
  version: "1",
  categories: ["Fx"],
  kind: "effect",
  architecture: "x86_64",
  buses: [],
  supportedAudioModes: ["stereo"],
  hasEditor: true,
  compatibility: "compatible",
  compatibilityReason: null
}
const disposers: Array<() => void> = []

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function request<Value>(
  channel: string,
  event: IpcMainInvokeEvent,
  requestMeta: RpcRequestMeta,
  ...args: unknown[]
): Promise<RpcResult<Value>> {
  const handler = electron.handle.mock.calls.find(([name]) => name === channel)?.[1]
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler(event, requestMeta, ...args)
}

function arrange() {
  const context = createContext()
  Object.assign(context.audioHost, {
    subscribePluginAnalysisShutdown: vi.fn(() => () => {}),
    subscribePluginAnalysisNotifications: vi.fn(() => () => {}),
    loadPlugin: vi.fn(async () => ({ latencySamples: 0, tailSamples: 0 })),
    pluginParameters: vi.fn(async () => []),
    unloadPluginAnalysisPlugin: vi.fn(async () => {}),
    closePluginEditor: vi.fn(async () => {}),
    openPluginEditor: vi.fn(async () => ({ editorMode: "native", open: true }))
  })
  Object.assign(context.plugins, {
    list: vi.fn(() => ({ plugins: [descriptor], scannedAt: 1 })),
    resolveDescriptorForRuntime: vi.fn(async (value: PluginDescriptor) => value)
  })
  const dispose = registerPluginAnalysisHandlers(context)
  disposers.push(dispose)
  const open = () =>
    request<void>(
      IPC_CHANNELS.pluginAnalysisOpen,
      trustedEvent(),
      mutationMeta(context.lifecycle.applicationState.desktopSession)
    )
  return { context, open }
}

async function openSession() {
  const setup = arrange()
  expect(await setup.open()).toMatchObject({ ok: true })
  const window = electron.Window.instances.at(-1)!
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame
  } as unknown as IpcMainInvokeEvent
  const snapshot = (requestMeta = meta(), acknowledge?: unknown, knownReportId?: unknown) =>
    request<PluginAnalysisSnapshot>(
      IPC_CHANNELS.pluginAnalysisSnapshot,
      event,
      requestMeta,
      acknowledge,
      knownReportId
    )
  const initial = await snapshot()
  if (!initial.ok) throw new Error(initial.error.code)
  const ref = initial.value.ref
  const command = (value: unknown, operationId: string, revision = 0, key = operationId) =>
    request<PluginAnalysisSnapshot>(
      IPC_CHANNELS.pluginAnalysisCommand,
      event,
      mutationMeta(ref, {
        expectedRevision: revision,
        mutation: { operationId, idempotencyKey: key }
      }),
      value
    )
  return { ...setup, window, event, snapshot, ref, command }
}

describe("Plugin Analysis RPC authority and receipts", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    electron.handle.mockReset()
    electron.loadURL.mockReset()
    electron.loadURL.mockResolvedValue(undefined)
    electron.Window.instances = []
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) dispose()
    await vi.waitFor(() => {
      expect(electron.Window.instances.every((window) => window.destroyed)).toBe(true)
    })
    vi.useRealTimers()
  })

  it("coalesces concurrent desktop opens until the analysis window is ready", async () => {
    const loading = deferred<void>()
    electron.loadURL.mockReturnValueOnce(loading.promise)
    const { open } = arrange()
    const first = open()
    const second = open()
    await vi.waitFor(() => expect(electron.Window.instances).toHaveLength(1))
    loading.resolve()
    expect(await Promise.all([first, second])).toMatchObject([
      { ok: true, requestId: "request-1", value: undefined },
      { ok: true, requestId: "request-1", value: undefined }
    ])
  })

  it("returns a retryable unavailable result after failed preparation and permits another open", async () => {
    const { open, context } = arrange()
    vi.mocked(context.settings.get).mockRejectedValueOnce(new Error("settings unavailable"))
    expect(await open()).toMatchObject({
      ok: false,
      error: { code: "resource-unavailable", outcome: "not-committed", retry: "safe" }
    })
    expect(await open()).toMatchObject({ ok: true })
    expect(electron.Window.instances).toHaveLength(1)
  })

  it("requires a current desktop mutation before allocating a window", async () => {
    const { context } = arrange()
    const desktop = context.lifecycle.applicationState.desktopSession
    expect(
      await request(IPC_CHANNELS.pluginAnalysisOpen, trustedEvent(), meta({ target: desktop }))
    ).toMatchObject({ ok: false, error: { details: { field: "mutation" } } })
    expect(
      await request(
        IPC_CHANNELS.pluginAnalysisOpen,
        trustedEvent(),
        mutationMeta({ ...desktop, generation: desktop.generation + 1 })
      )
    ).toMatchObject({ ok: false, error: { code: "stale-resource" } })
    expect(electron.Window.instances).toHaveLength(0)
  })

  it("rejects another renderer even when it knows the analysis resource", async () => {
    const { ref, snapshot } = await openSession()
    for (const [channel, args] of [
      [IPC_CHANNELS.pluginAnalysisSnapshot, []],
      [IPC_CHANNELS.pluginAnalysisCommand, [{ type: "automatic", enabled: false }]]
    ] as const) {
      expect(await request(channel, trustedEvent(), mutationMeta(ref), ...args)).toMatchObject({
        ok: false,
        error: { details: { field: "sender" } }
      })
    }
    expect(await snapshot()).toMatchObject({ ok: true, value: { automatic: true, revision: 0 } })
  })

  it("requires a read of the current analysis resource before acknowledging receipts", async () => {
    const { snapshot, ref } = await openSession()
    expect(await snapshot(meta(), "operation")).toMatchObject({
      ok: false,
      error: { details: { field: "acknowledge" } }
    })
    expect(await snapshot(meta({ target: { ...ref, generation: 2 } }))).toMatchObject({
      ok: false,
      error: { code: "stale-resource" }
    })
    expect(await snapshot(mutationMeta(ref))).toMatchObject({
      ok: false,
      error: { details: { field: "mutation" } }
    })
    expect(
      await snapshot(meta({ mutation: { operationId: "op", idempotencyKey: "key" } }))
    ).toMatchObject({
      ok: false,
      error: { details: { field: "mutation" } }
    })
  })

  it("does not apply commands sent as reads or against a retired analysis session", async () => {
    const { event, ref, snapshot } = await openSession()
    const disable: PluginAnalysisCommand = { type: "automatic", enabled: false }
    expect(
      await request(IPC_CHANNELS.pluginAnalysisCommand, event, meta({ target: ref }), disable)
    ).toMatchObject({ ok: false, error: { details: { field: "mutation" } } })
    expect(
      await request(
        IPC_CHANNELS.pluginAnalysisCommand,
        event,
        mutationMeta({ ...ref, generation: ref.generation + 1 }),
        disable
      )
    ).toMatchObject({ ok: false, error: { code: "stale-resource" } })
    expect(await snapshot()).toMatchObject({ ok: true, value: { automatic: true, revision: 0 } })
  })

  it("does not discard a receipt when another snapshot argument is invalid", async () => {
    const { command, snapshot, ref, window } = await openSession()
    const maximize: PluginAnalysisCommand = { type: "window", action: "maximize" }
    expect(await command(maximize, "maximize")).toMatchObject({ ok: true })
    expect(window.maximized).toBe(true)

    expect(await snapshot(meta({ target: ref }), "maximize", 42)).toMatchObject({
      ok: false,
      error: { details: { field: "knownReportId" } }
    })
    expect(await command(maximize, "maximize")).toMatchObject({ ok: true })
    expect(window.maximized).toBe(true)

    expect(await snapshot(meta({ target: ref }), "maximize")).toMatchObject({ ok: true })
    expect(await command(maximize, "maximize")).toMatchObject({ ok: true })
    expect(window.maximized).toBe(false)
  })

  it("replays an identical receipt despite its old revision and rejects reused identities", async () => {
    const { command, snapshot } = await openSession()
    const configure: PluginAnalysisCommand = {
      type: "configure",
      settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, level_dbfs: 6 }
    }
    const first = await command(configure, "configure", 0, "configure-key")
    expect(first).toMatchObject({ ok: true, value: { revision: 1, settings: { level_dbfs: 6 } } })
    expect(await command(configure, "configure", 0, "configure-key")).toEqual(first)
    expect(await command({ type: "automatic", enabled: false }, "configure", 1)).toMatchObject({
      ok: false,
      error: { details: { field: "operation-id" } }
    })
    expect(await command(configure, "other", 1, "configure-key")).toMatchObject({
      ok: false,
      error: { details: { field: "idempotency-key" } }
    })
    expect(await snapshot()).toMatchObject({ ok: true, value: { revision: 1, automatic: true } })
  })

  it("validates queued commands against the revision committed by the preceding command", async () => {
    const { command, snapshot } = await openSession()
    const configure = (level: number): PluginAnalysisCommand => ({
      type: "configure",
      settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, level_dbfs: level }
    })
    const first = command(configure(3), "first")
    const stale = command(configure(9), "second")
    expect(await first).toMatchObject({ ok: true, value: { revision: 1 } })
    expect(await stale).toMatchObject({
      ok: false,
      error: { code: "revision-conflict", details: { actualRevision: 1, expectedRevision: 0 } }
    })
    expect(await command(configure(9), "second", 1)).toMatchObject({
      ok: true,
      value: { revision: 2, settings: { level_dbfs: 9 } }
    })
    expect(await snapshot()).toMatchObject({ ok: true, value: { revision: 2 } })
  })

  it("applies receipt backpressure without losing replays and releases capacity on acknowledgement", async () => {
    const { command, snapshot, ref } = await openSession()
    const disable: PluginAnalysisCommand = { type: "automatic", enabled: false }
    for (let index = 0; index < 128; index += 1) {
      expect(await command(disable, `op-${index}`)).toMatchObject({ ok: true })
    }
    expect(await command(disable, "overflow")).toMatchObject({
      ok: false,
      error: { details: { field: "receipt-capacity" } }
    })
    expect(await command(disable, "op-0")).toMatchObject({ ok: true })
    expect(await snapshot(meta({ target: ref }), "op-0")).toMatchObject({ ok: true })
    expect(await command(disable, "overflow")).toMatchObject({
      ok: true,
      value: { automatic: false }
    })
  })

  it.each([
    null,
    { type: "unknown" },
    { type: "insert", pluginKey: "gain", audioMode: "stereo", slotOrder: -1 },
    { type: "remove", instanceId: 1 },
    { type: "move", instanceId: "gain", slotOrder: 0.5 },
    { type: "toggle", instanceId: "gain", enabled: "false" },
    { type: "configure", settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, level_dbfs: 13 } },
    { type: "automatic", enabled: "false" },
    { type: "window", action: "destroy" }
  ])("rejects malformed command %j before reserving its operation identity", async (invalid) => {
    const { command } = await openSession()
    expect(await command(invalid, "operation")).toMatchObject({
      ok: false,
      error: { details: { field: "command" } }
    })
    expect(await command({ type: "automatic", enabled: false }, "operation")).toMatchObject({
      ok: true,
      value: { automatic: false }
    })
  })

  it("routes chain and editor commands to the isolated analysis session", async () => {
    const { command } = await openSession()
    await command({ type: "automatic", enabled: false }, "disable")
    const inserted = await command(
      {
        type: "insert",
        pluginKey: pluginDescriptorKey(descriptor),
        audioMode: "stereo",
        slotOrder: 0
      },
      "insert"
    )
    expect(inserted).toMatchObject({
      ok: true,
      value: { revision: 1, plugins: [{ descriptor, enabled: true, slotOrder: 0 }] }
    })
    if (!inserted.ok) throw new Error(inserted.error.code)
    const instanceId = inserted.value.plugins[0]!.id
    expect(await command({ type: "editor", instanceId }, "editor", 1)).toMatchObject({
      ok: true,
      value: { runtime: { [instanceId]: { editorOpen: true, editorMode: "native" } } }
    })
    expect(await command({ type: "move", instanceId, slotOrder: 0 }, "move", 1)).toMatchObject({
      ok: true,
      value: { revision: 2, plugins: [{ id: instanceId, slotOrder: 0 }] }
    })
    expect(
      await command({ type: "toggle", instanceId, enabled: false }, "toggle", 2)
    ).toMatchObject({
      ok: true,
      value: { revision: 3, plugins: [{ id: instanceId, enabled: false }] }
    })
    expect(await command({ type: "remove", instanceId }, "remove", 3)).toMatchObject({
      ok: true,
      value: { revision: 4, plugins: [], runtime: {} }
    })
  })

  it("serializes catalog refresh and exposes analysis cancellation before closing the window", async () => {
    const { command, context, window } = await openSession()
    const scanning = deferred<PluginCatalogSnapshot>()
    vi.mocked(context.plugins.scan).mockReturnValueOnce(scanning.promise)
    const refresh = command({ type: "refresh-catalog" }, "refresh")
    const analyze = command({ type: "analyze" }, "analyze")
    await vi.waitFor(() => expect(context.plugins.scan).toHaveBeenCalled())
    scanning.resolve({ plugins: [descriptor], scannedAt: 2, scannerVersion: 1, scanning: false })
    expect(await refresh).toMatchObject({ ok: true, value: { status: "idle" } })
    expect(await analyze).toMatchObject({ ok: true, value: { status: "debouncing" } })
    expect(await command({ type: "cancel" }, "cancel")).toMatchObject({
      ok: true,
      value: { status: "cancelled" }
    })
    expect(await command({ type: "window", action: "minimize" }, "minimize")).toMatchObject({
      ok: true
    })
    expect(window.minimized).toBe(true)
    expect(await command({ type: "window", action: "close" }, "close")).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(window.destroyed).toBe(true))
  })
})
