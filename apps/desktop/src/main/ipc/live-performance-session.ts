import { randomUUID } from "node:crypto"
import type {
  LiveCapturePreview,
  LivePerformCommand,
  LivePerformanceSnapshot,
  LiveWorkspaceSnapshot
} from "@heron/contracts"
import type { AudioHostService } from "../audio-host"
import type { LifecycleCoordinator } from "../kernel"
import type { PluginCatalogService } from "../plugins"
import {
  LiveAudioRuntime,
  LivePerformanceController,
  LiveRuntimeFailure,
  type LiveDocumentService
} from "../project"
import { normalizeAudioRuntime } from "./support"

/** Owns a single document's runtime; resource publication stays in Electron main. */
export class LivePerformanceSession {
  private runtime: LiveAudioRuntime | null = null
  private controller: LivePerformanceController | null = null

  constructor(
    private readonly documents: LiveDocumentService,
    private readonly audioHost: AudioHostService,
    private readonly plugins: PluginCatalogService,
    private readonly lifecycle: LifecycleCoordinator
  ) {}

  get mode(): LiveWorkspaceSnapshot["mode"] {
    return this.controller?.currentMode ?? "edit"
  }

  get performance(): LivePerformanceSnapshot | null {
    const performance = this.controller?.currentPerformance
    return performance
      ? {
          ...performance,
          runtimePluginIds: this.runtime?.runtimePluginIds ?? {}
        }
      : null
  }

  async execute(workspace: LiveWorkspaceSnapshot, command: LivePerformCommand): Promise<void> {
    if (!this.controller) {
      if (command.type !== "enter") throw new TypeError("Perform has not been entered")
      this.runtime = new LiveAudioRuntime({
        audioHost: this.audioHost,
        plugins: this.plugins,
        projectGraph: workspace.projectGraph
      })
      this.controller = new LivePerformanceController(this.documents, this.runtime)
    }
    try {
      switch (command.type) {
        case "enter":
          await this.controller.enter()
          break
        case "activate":
          await this.controller.activate(command.layerId, command.disposition)
          break
        case "adjust":
          await this.controller.adjust(command.command)
          break
        case "capture":
          await this.controller.capture(command.captureId, command.fields, command.stateTargets)
          break
        case "leave":
          await this.controller.leave(command.disposition)
          break
      }
    } finally {
      if (command.type === "enter" || command.type === "leave") {
        await this.publishAudio(command.type === "enter")
      }
    }
  }

  previewCapture(): Promise<LiveCapturePreview> {
    if (!this.controller) throw new TypeError("Perform has not been entered")
    return this.controller.previewCapture()
  }

  async close(): Promise<void> {
    if (this.runtime) {
      await this.runtime.close()
      await this.publishAudio(false)
    }
    this.runtime = null
    this.controller = null
  }

  private async publishAudio(replace: boolean): Promise<void> {
    try {
      const state = this.lifecycle.applicationState
      const runtime = normalizeAudioRuntime(await this.audioHost.audioEngineSnapshot())
      if (runtime.state === "running") {
        if (replace || !state.audioResourceSnapshot().engine) await state.commitAudioEngine(runtime)
      } else {
        await state.dropAudioEngine()
      }
      this.lifecycle.completeAudio(runtime)
    } catch {
      // Audio may already have committed. A publication failure must not invite a retry.
      throw new LiveRuntimeFailure({
        code: "invariant-violation",
        category: "invariant-violation",
        outcome: "quarantined",
        retry: "after-reconcile",
        correlationId: `live-audio-publication-${randomUUID()}`,
        userMessageKey: "errors.projectQuarantined",
        details: { type: "invariant-violation", component: "main" }
      })
    }
  }
}
