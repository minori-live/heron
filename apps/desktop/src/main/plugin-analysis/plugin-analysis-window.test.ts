import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcMainInvokeEvent } from "electron"

const fake = vi.hoisted(() => {
  const close = vi.fn(async () => {})
  const snapshot = vi.fn(() => ({ status: "complete" }))
  class Window {
    static instances: Window[] = []
    destroyed = false
    readonly webContents = {
      mainFrame: { url: "" },
      getURL: () => this.webContents.mainFrame.url,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
    loadURL = vi.fn(async (url: string) => {
      this.webContents.mainFrame.url = url
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
  return { Window, close, snapshot }
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
  const manager = new PluginAnalysisWindow({
    audioHost: {
      subscribePluginAnalysisShutdown: (listener: () => Promise<void>) => {
        shutdown = listener
        return () => {}
      }
    },
    plugins: { list: () => ({ plugins: [] }) },
    settings: { get: async () => ({ locale: "en-US", theme: "system" }) }
  } as never)
  return { manager, shutdown: () => shutdown }
}

describe("Plugin Analysis window ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fake.Window.instances = []
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
    fake.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    const closing = manager.close()
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
})
