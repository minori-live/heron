import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import type {
  LiveCaptureField,
  LiveCapturePreview,
  LiveDocumentConfiguration,
  LivePerformanceCommand,
  LiveRuntimeSnapshot
} from "@heron/contracts"
import {
  applyLiveCapture,
  applyLivePerformanceCommand,
  diffLiveCapture
} from "@heron/project-model"
import type { LiveDocumentService } from "./live-document-service"

/** Implementations own exact-device checks, fresh instances, and native commit reconciliation. */
export interface LiveRuntimePort {
  synchronizeEditState(snapshot: LiveRuntimeSnapshot): Promise<LiveRuntimeSnapshot>
  prepare(
    configuration: LiveDocumentConfiguration,
    snapshot: LiveRuntimeSnapshot,
    generation: number
  ): Promise<unknown>
  activate(candidate: unknown): Promise<void>
  abort(candidate: unknown): Promise<void>
  apply(command: LivePerformanceCommand, generation: number): Promise<void>
  snapshot(generation: number): Promise<LiveRuntimeSnapshot>
  restoreBaseline(
    configuration: LiveDocumentConfiguration,
    snapshot: LiveRuntimeSnapshot,
    generation: number
  ): Promise<void>
  leave(generation: number): Promise<void>
}

interface FrozenCapture {
  preview: LiveCapturePreview
  snapshot: LiveRuntimeSnapshot
}

export class LivePerformanceController {
  private mode: "edit" | "preparing-perform" | "perform" | "leaving-perform" = "edit"
  private generation = 0
  private runtimeRevision = 0
  private baseline: LiveRuntimeSnapshot | null = null
  private runtime: LiveRuntimeSnapshot | null = null
  private documentRevision = 0
  private frozen: FrozenCapture | null = null
  private adjustmentTail: Promise<void> = Promise.resolve()
  private leavingRequested = false

  constructor(
    private readonly documents: Pick<LiveDocumentService, "current" | "baseline" | "commitCapture">,
    private readonly port: LiveRuntimePort
  ) {}

  get currentMode(): typeof this.mode {
    return this.mode
  }
  get currentGeneration(): number {
    return this.generation
  }

  async enter(): Promise<void> {
    if (this.mode !== "edit") throw new Error("Live is not in Edit mode")
    const configuration = this.documents.current?.configuration
    if (!configuration?.audio) throw new Error("Configure exact Live audio devices before Perform")
    this.mode = "preparing-perform"
    let candidate: unknown
    try {
      let { snapshot, revision } = await this.documents.baseline()
      const synchronized = await this.port.synchronizeEditState(snapshot)
      if (!isDeepStrictEqual(synchronized, snapshot)) {
        revision = await this.documents.commitCapture(synchronized, revision)
        snapshot = synchronized
      }
      const generation = this.generation + 1
      candidate = await this.port.prepare(configuration, snapshot, generation)
      await this.port.activate(candidate)
      this.baseline = structuredClone(snapshot)
      this.runtime = structuredClone(snapshot)
      this.documentRevision = revision
      this.runtimeRevision = 0
      this.generation = generation
      this.frozen = null
      this.mode = "perform"
    } catch (error) {
      if (candidate !== undefined) await this.port.abort(candidate).catch(() => undefined)
      this.mode = "edit"
      throw error
    }
  }

  async adjust(command: LivePerformanceCommand): Promise<void> {
    if (this.mode !== "perform" || this.leavingRequested)
      throw new Error("Live is not accepting adjustments")
    const pending = this.adjustmentTail.then(async () => {
      if (this.mode !== "perform" || !this.runtime) throw new Error("Live is not performing")
      const next = applyLivePerformanceCommand(this.runtime, command)
      await this.port.apply(command, this.generation)
      this.runtime = next
      this.runtimeRevision += 1
    })
    this.adjustmentTail = pending.catch(() => undefined)
    return pending
  }

  async previewCapture(): Promise<LiveCapturePreview> {
    const pending = this.adjustmentTail.then(async () => {
      if (this.mode !== "perform" || !this.baseline || !this.runtime) {
        throw new Error("Live is not performing")
      }
      const sampled = await this.port.snapshot(this.generation)
      const fields = diffLiveCapture(this.baseline, sampled)
      if (!isDeepStrictEqual(sampled, this.runtime)) {
        this.runtime = structuredClone(sampled)
        this.runtimeRevision += 1
      }
      this.frozen = {
        preview: {
          captureId: randomUUID(),
          documentRevision: this.documentRevision,
          runtimeRevision: this.runtimeRevision,
          fields
        },
        snapshot: structuredClone(sampled)
      }
      return structuredClone(this.frozen.preview)
    })
    this.adjustmentTail = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }

  async capture(captureId: string, fields: LiveCaptureField[]): Promise<LiveCaptureField[]> {
    if (
      this.mode !== "perform" ||
      !this.baseline ||
      !this.runtime ||
      this.frozen?.preview.captureId !== captureId
    ) {
      throw new Error("Capture preview is unavailable or stale")
    }
    const frozen = this.frozen
    const next = applyLiveCapture(this.baseline, frozen.snapshot, frozen.preview.fields, fields)
    if (fields.length === 0) return diffLiveCapture(this.baseline, this.runtime)
    const revision = await this.documents.commitCapture(next, frozen.preview.documentRevision)
    this.baseline = next
    this.documentRevision = revision
    this.frozen = null
    return diffLiveCapture(next, this.runtime)
  }

  hasUncapturedChanges(): boolean {
    return Boolean(
      this.baseline && this.runtime && diffLiveCapture(this.baseline, this.runtime).length
    )
  }

  async leave(disposition: "capture" | "discard" | "cancel"): Promise<boolean> {
    if (this.mode !== "perform" || !this.baseline || !this.runtime) {
      throw new Error("Live is not performing")
    }
    if (disposition === "cancel") return false
    this.leavingRequested = true
    try {
      await this.adjustmentTail
      if (disposition === "capture" && this.hasUncapturedChanges()) {
        const preview = await this.previewCapture()
        await this.capture(preview.captureId, preview.fields)
        if (this.hasUncapturedChanges()) return false
      }
      this.mode = "leaving-perform"
      if (disposition === "capture" && this.hasUncapturedChanges()) {
        this.mode = "perform"
        return false
      }
      if (disposition === "discard" && this.hasUncapturedChanges()) {
        const configuration = this.documents.current?.configuration
        if (!configuration) throw new Error("Live document is closed")
        await this.port.restoreBaseline(configuration, this.baseline, this.generation + 1)
        this.generation += 1
      }
      await this.port.leave(this.generation)
      this.baseline = null
      this.runtime = null
      this.frozen = null
      this.mode = "edit"
      return true
    } catch (error) {
      this.mode = "perform"
      throw error
    } finally {
      this.leavingRequested = false
    }
  }
}
