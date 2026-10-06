import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcMainInvokeEvent } from "electron"

const fake = vi.hoisted(() => {
  const close = vi.fn(async () => {})
  const snapshot = vi.fn(() => ({ status: "complete" }))
  const load = vi.fn(async () => {})
  class Window {
    static instances: Window[] = []
    destroyed = false
    webContentsDestroyed = false
    readonly webContents = {
      isDestroyed: () => this.webContentsDestroyed || this.destroyed,
      mainFrame: { url: "" },
      getURL: () => this.webContents.mainFrame.url,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
    loadURL = vi.fn(async (url: string) => {
      this.webContents.mainFrame.url = url
      await load()
    })
    show = vi.fn()
    focus = vi.fn()
    on = vi.fn()
    once = vi.fn()
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    isDestroyed = () => this.destroyed
    constructor() {
      Window.instances.push(this)
    }
  }
  return { Window, close, snapshot, load }
})

vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: fake.Window,
  nativeTheme: { shouldUseDarkColors: false }
}))
vi.mock("../app/windows", () => ({
  mainWindowPlatformOptions: () => ({}),
  secureWebPreferences: () => ({})
}))
vi.mock("./plugin-analysis-service", () => ({
  PluginAnalysisService: class {
    close = fake.close
    snapshot = fake.snapshot
  }
}))

import { PluginAnalysisWindow } from "./plugin-analysis-window"

function arrange() {
  let shutdown: (() => Promise<void>) | null = null
  const settings = vi.fn(async () => ({ locale: "en-US", theme: "system" }))
  const unsubscribe = vi.fn()
  const manager = new PluginAnalysisWindow({
    audioHost: {
      subscribePluginAnalysisShutdown: (listener: () => Promise<void>) => {
        shutdown = listener
        return unsubscribe
      }
    },
    plugins: { list: () => ({ plugins: [] }) },
    settings: { get: settings }
  } as never)
  return { manager, settings, unsubscribe, shutdown: () => shutdown }
}

describe("Plugin Analysis window ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fake.Window.instances = []
    fake.snapshot.mockReturnValue({ status: "complete" })
    fake.load.mockReset()
  })

  it("reuses the experiment window and accepts only its main frame at the pluginAnalysis entrypoint", async () => {
    const { manager } = arrange()
    await manager.open()
    await manager.open()
    expect(fake.Window.instances).toHaveLength(1)
    const window = fake.Window.instances[0]!
    expect(window.loadURL).toHaveBeenCalledWith("heron-app://bundle/plugin-analysis.html")
    expect(window.focus).toHaveBeenCalledOnce()
    const event = {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame
    } as unknown as IpcMainInvokeEvent
    expect(() => manager.authenticate(event)).not.toThrow()
    expect(() =>
      manager.authenticate({
        ...event,
        senderFrame: { url: event.senderFrame!.url }
      } as IpcMainInvokeEvent)
    ).toThrow()
    expect(() =>
      manager.authenticate({
        ...event,
        sender: { ...window.webContents }
      } as unknown as IpcMainInvokeEvent)
    ).toThrow()
    window.webContents.mainFrame.url = "heron-app://bundle/index.html"
    expect(() => manager.authenticate(event)).toThrow()
    await manager.close()
  })

  it("waits for session cleanup before destroying the independent window", async () => {
    const { manager } = arrange()
    await manager.open()
    const window = fake.Window.instances[0]!
    let settle!: () => void
    const child = new fake.Window()
    manager.eqFit.window = child as never
    fake.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    const closing = manager.close()
    expect(child.destroyed).toBe(true)
    expect(
      await manager.eqFit.apply(
        { protocolVersion: 2, requestId: "during-close" },
        { sequence: 1, selection: null, open: false }
      )
    ).toMatchObject({ ok: false, error: { details: { field: "closed-session" } } })
    expect(manager.close()).toBe(closing)
    expect(window.destroyed).toBe(false)
    settle()
    await closing
    expect(window.destroyed).toBe(true)
    expect(manager.service).toBeNull()
  })

  it("retains a quarantined session until the native runtime is replaced", async () => {
    const { manager, shutdown } = arrange()
    await manager.open()
    fake.snapshot.mockReturnValue({ status: "quarantined" })
    await manager.close()
    expect(await manager.open()).toBe(false)
    expect(fake.Window.instances).toHaveLength(1)
    fake.snapshot.mockReturnValue({ status: "complete" })
    await shutdown()!()
    expect(await manager.open()).toBe(true)
  })

  it("retires a force-destroyed parent before native cleanup and ignores late old-window events", async () => {
    const { manager } = arrange()
    await manager.open()
    const parent = fake.Window.instances[0]!
    const child = new fake.Window()
    manager.eqFit.window = child as never
    let settle!: () => void
    fake.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    const rendererDestroyed = parent.webContents.on.mock.calls.find(
      ([name]) => name === "destroyed"
    )?.[1]
    const windowClosed = parent.once.mock.calls.find(([name]) => name === "closed")?.[1]
    // DevTools target closure and forced destruction can bypass cancellable "close".
    parent.webContentsDestroyed = true
    expect(
      await manager.eqFit.apply(
        { protocolVersion: 2, requestId: "destroyed-renderer" },
        { sequence: 1, selection: null, open: false }
      )
    ).toMatchObject({ ok: false, error: { details: { field: "closed-session" } } })
    parent.destroyed = true
    rendererDestroyed?.()
    windowClosed?.()
    expect(child.destroyed).toBe(true)
    expect(fake.close).toHaveBeenCalledOnce()
    expect(
      await manager.eqFit.apply(
        { protocolVersion: 2, requestId: "retired-parent" },
        { sequence: 1, selection: null, open: false }
      )
    ).toMatchObject({ ok: false, error: { details: { field: "closed-session" } } })
    const closing = manager.close()
    const reopening = manager.open()
    rendererDestroyed?.()
    windowClosed?.()
    settle()
    await closing
    expect(await reopening).toBe(true)
    const replacement = manager.window
    const newChild = new fake.Window()
    manager.eqFit.window = newChild as never
    rendererDestroyed?.()
    windowClosed?.()
    expect(manager.window).toBe(replacement)
    expect(newChild.destroyed).toBe(false)
    expect(fake.close).toHaveBeenCalledOnce()
    await manager.close()
  })

  it("abandons a pending open when runtime shutdown wins the settings load", async () => {
    const { manager, settings, shutdown } = arrange()
    let resolveSettings!: (value: { locale: string; theme: string }) => void
    settings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve
        })
    )
    const opening = manager.open()
    await shutdown()!()
    resolveSettings({ locale: "en-US", theme: "system" })

    expect(await opening).toBe(false)
    expect(manager.service).toBeNull()
    expect(fake.Window.instances).toHaveLength(0)
    expect(await manager.open()).toBe(true)
    await manager.close()
  })

  it("refuses pending and subsequent opens after disposal", async () => {
    const { manager, settings, unsubscribe } = arrange()
    let resolveSettings!: (value: { locale: string; theme: string }) => void
    settings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve
        })
    )
    const opening = manager.open()
    manager.dispose()
    resolveSettings({ locale: "en-US", theme: "system" })

    expect(await opening).toBe(false)
    expect(await manager.open()).toBe(false)
    expect(fake.Window.instances).toHaveLength(0)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("releases a candidate after renderer loading fails and allows a fresh session", async () => {
    const { manager } = arrange()
    fake.load.mockRejectedValueOnce(new Error("renderer load failed"))
    expect(await manager.open()).toBe(false)
    expect(fake.close).toHaveBeenCalledOnce()
    expect(fake.Window.instances[0]!.destroyed).toBe(true)
    expect(manager.service).toBeNull()

    expect(await manager.open()).toBe(true)
    expect(fake.Window.instances).toHaveLength(2)
    await manager.close()
  })
})
