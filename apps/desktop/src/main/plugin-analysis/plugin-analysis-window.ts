import { app, BrowserWindow, nativeTheme } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { mainWindowPlatformOptions, secureWebPreferences } from "../app/windows"
import { applicationIconPath } from "../app/runtime-paths"
import {
  classifyRendererEntrypoint,
  resolveRendererEntrypoints
} from "../../shared/renderer-security"
import type { IpcHandlerContext } from "../ipc/context"
import { PluginAnalysisService } from "./plugin-analysis-service"

export class PluginAnalysisWindow {
  window: BrowserWindow | null = null
  service: PluginAnalysisService | null = null
  private closing: Promise<void> | null = null
  private closeGeneration = 0
  private disposed = false
  private quarantineOwner: PluginAnalysisService | null = null
  private unsubscribeShutdown: () => void

  constructor(private readonly context: IpcHandlerContext) {
    this.unsubscribeShutdown = context.audioHost.subscribePluginAnalysisShutdown(async () => {
      // The native runtime is being replaced, so the retained quarantine is resolved.
      await this.close()
      this.quarantineOwner = null
    })
  }

  async open(): Promise<boolean> {
    const generation = this.closeGeneration
    if (this.closing) await this.closing
    if (this.disposed || generation !== this.closeGeneration) return false
    // A quarantined session still owns native instances and its unreleased job.
    // Refuse a new session against the same runtime instead of losing the owner.
    if (this.quarantineOwner) return false
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      return true
    }
    const settings = await this.context.settings.get()
    // Closing can finish while settings are loading, before a session exists.
    // Do not publish that stale open against a retired native runtime.
    if (this.disposed || generation !== this.closeGeneration) return false
    const service = new PluginAnalysisService(
      this.context.audioHost,
      () => this.context.plugins.list().plugins,
      {
        locale: settings.locale,
        theme:
          settings.theme === "system"
            ? nativeTheme.shouldUseDarkColors
              ? "dark"
              : "light"
            : settings.theme
      },
      undefined,
      (descriptor) => this.context.plugins.resolveDescriptorForRuntime(descriptor),
      () => this.context.plugins.scan({ force: true, retryQuarantined: true })
    )
    this.service = service
    try {
      const window = new BrowserWindow({
        title: "Plugin Analysis",
        icon: applicationIconPath,
        width: 1320,
        height: 850,
        minWidth: 980,
        minHeight: 640,
        show: false,
        backgroundColor: "#0b0e13",
        ...mainWindowPlatformOptions(process.platform),
        webPreferences: secureWebPreferences()
      })
      this.window = window
      this.service = service
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      window.webContents.on("will-navigate", (event) => event.preventDefault())
      window.on("close", (event) => {
        event.preventDefault()
        void this.close()
      })
      window.webContents.on("render-process-gone", () => void this.close())
      window.once("ready-to-show", () => {
        if (!window.isDestroyed()) window.show()
      })
      const renderer = resolveRendererEntrypoints(app.isPackaged, process.env.HERON_RENDERER_URL)
      await window.loadURL(new URL("plugin-analysis.html", renderer.main).toString())
      return this.window === window && !window.isDestroyed()
    } catch {
      await this.close()
      return false
    }
  }

  authenticate(event: IpcMainInvokeEvent): void {
    const url = event.senderFrame?.url ?? event.sender.getURL()
    const renderer = resolveRendererEntrypoints(app.isPackaged, process.env.HERON_RENDERER_URL)
    if (
      event.sender !== this.window?.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      classifyRendererEntrypoint(url) !== "plugin-analysis" ||
      new URL(url).origin !== new URL(renderer.main).origin ||
      !this.service
    ) {
      throw new Error("Untrusted Plugin Analysis sender")
    }
  }

  close(): Promise<void> {
    this.closeGeneration += 1
    if (this.closing) return this.closing
    const service = this.service
    const window = this.window
    this.closing = (async () => {
      await service?.close()
      if (service?.snapshot().status === "quarantined") this.quarantineOwner = service
      if (window && !window.isDestroyed()) window.destroy()
      this.window = null
      this.service = null
    })().finally(() => {
      this.closing = null
    })
    return this.closing
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribeShutdown()
    void this.close()
  }
}
