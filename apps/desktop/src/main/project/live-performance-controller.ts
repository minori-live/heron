import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import type {
  LiveCaptureField,
  LiveCapturePreview,
  LiveCaptureStateTarget,
  LiveDocumentConfiguration,
  LiveLayerId,
  LiveMode,
  LivePerformanceCommand,
  LivePerformanceSnapshot,
  LiveRuntimeSnapshot,
  RpcError
} from "@heron/contracts"
import {
  applyLiveCapture,
  applyLivePerformanceCommand,
  diffLiveCapture,
  resolveLiveLayer
} from "@heron/project-model"
import type { LiveDocumentService } from "./live-document-service"

/** Internal failures retain the serializable error; the IPC boundary returns its union. */
export class LiveRuntimeFailure extends Error {
  constructor(readonly error: RpcError) {
    super(error.code)
  }
}

/** A failed preparation must preserve the active graph and clean partial resources. */
export interface LiveRuntimePort {
  synchronizeEditState(snapshot: LiveRuntimeSnapshot): Promise<LiveRuntimeSnapshot>
  prepare(
    configuration: LiveDocumentConfiguration,
    snapshot: LiveRuntimeSnapshot,
    generation: number
  ): Promise<unknown>
  /** Check authority immediately before the native commit; reconcile unknown acknowledgements. */
  activate(candidate: unknown, isCurrent: () => boolean): Promise<void>
  abort(candidate: unknown): Promise<void>
  apply(command: LivePerformanceCommand, generation: number): Promise<void>
  snapshot(generation: number): Promise<LiveRuntimeSnapshot>
  leave(generation: number): Promise<void>
}

type Documents = Pick<
  LiveDocumentService,
  "current" | "baseline" | "commitCapture" | "commitLayerCapture"
>

function validation(field: string): LiveRuntimeFailure {
  return new LiveRuntimeFailure({
    code: "validation-failed",
    category: "validation",
    outcome: "not-committed",
    retry: "never",
    correlationId: randomUUID(),
    userMessageKey: "errors.invalidRpcRequest",
    details: { type: "validation-failed", field }
  })
}

function unavailable(): LiveRuntimeFailure {
  return new LiveRuntimeFailure({
    code: "resource-unavailable",
    category: "unavailable",
    outcome: "not-committed",
    retry: "safe",
    correlationId: randomUUID(),
    userMessageKey: "errors.audioEngineUnavailable",
    details: { type: "resource-unavailable", component: "audio-host", dispatched: false }
  })
}

function cancelled(): LiveRuntimeFailure {
  return new LiveRuntimeFailure({
    code: "operation-cancelled",
    category: "cancelled",
    outcome: "not-committed",
    retry: "never",
    correlationId: randomUUID(),
    userMessageKey: "errors.operationCancelled",
    details: { type: "operation-cancelled", committed: false }
  })
}

function quarantined(): LiveRuntimeFailure {
  return new LiveRuntimeFailure({
    code: "invariant-violation",
    category: "invariant-violation",
    outcome: "quarantined",
    retry: "after-reconcile",
    correlationId: randomUUID(),
    userMessageKey: "errors.projectQuarantined",
    details: { type: "invariant-violation", component: "audio-host" }
  })
}

function normalizeFailure(error: unknown): LiveRuntimeFailure {
  if (error instanceof LiveRuntimeFailure) return error
  if (error instanceof TypeError || error instanceof RangeError)
    return validation("live.performance")
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "operation-outcome-unknown") return quarantined()
    if (error.code === "validation-failed") return validation("live.capture")
    if (error.code === "revision-conflict") {
      return new LiveRuntimeFailure({
        code: "revision-conflict",
        category: "conflict",
        outcome: "not-committed",
        retry: "after-reconcile",
        correlationId: randomUUID(),
        userMessageKey: "errors.revisionConflict"
      })
    }
  }
  return unavailable()
}

export class LivePerformanceController {
  private mode: LiveMode = "edit"
  private generation = 0
  private nextGeneration = 0
  private activationAuthority = 0
  private runtimeRevision = 0
  private activeLayerId: LiveLayerId = null
  private baseline: LiveRuntimeSnapshot | null = null
  private runtime: LiveRuntimeSnapshot | null = null
  private documentRevision = 0
  private frozen: LiveCapturePreview | null = null
  private operationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly documents: Documents,
    private readonly port: LiveRuntimePort
  ) {}

  get currentMode(): LiveMode {
    return this.mode
  }

  get currentGeneration(): number {
    return this.generation
  }

  get currentPerformance(): LivePerformanceSnapshot | null {
    if (!this.baseline || !this.runtime) return null
    return {
      activeLayerId: this.activeLayerId,
      generation: this.generation,
      runtimeRevision: this.runtimeRevision,
      snapshot: structuredClone(this.runtime),
      uncapturedFields: diffLiveCapture(this.baseline, this.runtime)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationTail.then(async () => {
      if (this.mode === "quarantined") throw quarantined()
      try {
        return await operation()
      } catch (error) {
        const failure = normalizeFailure(error)
        if (failure.error.outcome !== "not-committed") this.mode = "quarantined"
        throw failure
      }
    })
    this.operationTail = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }

  private configuration(): LiveDocumentConfiguration {
    const configuration = this.documents.current?.configuration
    if (!configuration?.audio) throw validation("live.audio")
    return configuration
  }

  private requirePerform(): void {
    if (this.mode !== "perform" || !this.baseline || !this.runtime) {
      throw validation("live.mode")
    }
  }

  private async replaceGraph(
    configuration: LiveDocumentConfiguration,
    snapshot: LiveRuntimeSnapshot,
    authority: number
  ): Promise<number> {
    const isCurrent = () => authority === this.activationAuthority
    if (!isCurrent()) throw cancelled()
    const generation = ++this.nextGeneration
    let candidate: unknown
    let prepared = false
    try {
      candidate = await this.port.prepare(configuration, snapshot, generation)
      prepared = true
      if (!isCurrent()) throw cancelled()
      try {
        await this.port.activate(candidate, isCurrent)
      } catch (error) {
        // An untyped activation failure may have committed. Never free a possibly active graph.
        throw error instanceof LiveRuntimeFailure ? error : quarantined()
      }
      return generation
    } catch (error) {
      const failure = normalizeFailure(error)
      if (failure.error.outcome === "not-committed" && prepared) {
        try {
          await this.port.abort(candidate)
        } catch {
          throw quarantined()
        }
      }
      throw failure
    }
  }

  enter(): Promise<void> {
    const authority = ++this.activationAuthority
    return this.enqueue(async () => {
      if (this.mode !== "edit") throw validation("live.mode")
      const configuration = this.configuration()
      this.mode = "preparing-perform"
      try {
        let { snapshot, revision } = await this.documents.baseline()
        const synchronized = await this.port.synchronizeEditState(snapshot)
        if (!isDeepStrictEqual(synchronized, snapshot)) {
          revision = await this.documents.commitCapture(synchronized, revision)
          snapshot = synchronized
        }
        const generation = await this.replaceGraph(configuration, snapshot, authority)
        this.baseline = structuredClone(snapshot)
        this.runtime = structuredClone(snapshot)
        this.documentRevision = revision
        this.activeLayerId = null
        this.runtimeRevision = 0
        this.generation = generation
        this.frozen = null
        this.mode = "perform"
      } catch (error) {
        this.mode = "edit"
        throw error
      }
    })
  }

  activate(layerId: LiveLayerId, disposition: "discard" | "cancel"): Promise<boolean> {
    if (disposition === "cancel") return this.enqueue(async () => false)
    const authority = ++this.activationAuthority
    return this.enqueue(async () => {
      this.requirePerform()
      const document = await this.documents.baseline()
      if (layerId !== null && !document.hierarchy.patches.some((patch) => patch.id === layerId)) {
        throw validation("live.patch")
      }
      const snapshot = resolveLiveLayer(document.snapshot, document.hierarchy, layerId)
      const generation = await this.replaceGraph(this.configuration(), snapshot, authority)
      this.baseline = structuredClone(snapshot)
      this.runtime = structuredClone(snapshot)
      this.documentRevision = document.revision
      this.activeLayerId = layerId
      this.generation = generation
      this.runtimeRevision = 0
      this.frozen = null
      return true
    })
  }

  adjust(command: LivePerformanceCommand): Promise<void> {
    return this.enqueue(async () => {
      this.requirePerform()
      let next: LiveRuntimeSnapshot
      try {
        next = applyLivePerformanceCommand(this.runtime!, command)
      } catch {
        throw validation("live.adjustment")
      }
      try {
        await this.port.apply(command, this.generation)
      } catch (error) {
        throw error instanceof LiveRuntimeFailure ? error : quarantined()
      }
      this.runtime = next
      this.runtimeRevision += 1
    })
  }

  previewCapture(): Promise<LiveCapturePreview> {
    return this.enqueue(async () => {
      this.requirePerform()
      const sampled = await this.port.snapshot(this.generation)
      let changed: LiveCaptureField[]
      try {
        changed = diffLiveCapture(this.baseline!, sampled)
      } catch {
        throw quarantined()
      }
      if (!isDeepStrictEqual(sampled, this.runtime)) {
        this.runtime = structuredClone(sampled)
        this.runtimeRevision += 1
      }
      this.frozen = {
        captureId: randomUUID(),
        documentRevision: this.documentRevision,
        runtimeRevision: this.runtimeRevision,
        generation: this.generation,
        activeLayerId: this.activeLayerId,
        baseline: structuredClone(this.baseline!),
        runtime: structuredClone(sampled),
        fields: changed,
        blockedFields: []
      }
      return structuredClone(this.frozen)
    })
  }

  capture(
    captureId: string,
    fields: LiveCaptureField[],
    stateTargets: LiveCaptureStateTarget[] = []
  ): Promise<LiveCaptureField[]> {
    return this.enqueue(async () => {
      this.requirePerform()
      const frozen = this.frozen
      if (
        !frozen ||
        frozen.captureId !== captureId ||
        frozen.generation !== this.generation ||
        frozen.activeLayerId !== this.activeLayerId
      ) {
        throw validation("live.capture")
      }
      try {
        applyLiveCapture(this.baseline!, frozen.runtime, frozen.fields, fields)
      } catch {
        throw validation("live.capture.fields")
      }
      if (fields.length === 0) {
        if (stateTargets.length) throw validation("live.capture.stateTargets")
        return diffLiveCapture(this.baseline!, this.runtime!)
      }
      const committed = await this.documents.commitLayerCapture(
        this.activeLayerId,
        frozen.runtime,
        frozen.fields,
        fields,
        frozen.documentRevision,
        stateTargets
      )
      this.baseline = resolveLiveLayer(committed.snapshot, committed.hierarchy, this.activeLayerId)
      this.documentRevision = committed.revision
      this.frozen = null
      return diffLiveCapture(this.baseline, this.runtime!)
    })
  }

  hasUncapturedChanges(): boolean {
    return Boolean(
      this.baseline && this.runtime && diffLiveCapture(this.baseline, this.runtime).length
    )
  }

  leave(disposition: "discard" | "cancel"): Promise<boolean> {
    if (disposition === "cancel") return this.enqueue(async () => false)
    this.activationAuthority += 1
    return this.enqueue(async () => {
      this.requirePerform()
      this.mode = "leaving-perform"
      try {
        try {
          // Edit is silent. Confirm runtime shutdown before clearing its ownership or state.
          await this.port.leave(this.generation)
        } catch (error) {
          throw error instanceof LiveRuntimeFailure ? error : quarantined()
        }
        this.baseline = null
        this.runtime = null
        this.runtimeRevision = 0
        this.frozen = null
        this.activeLayerId = null
        this.mode = "edit"
        return true
      } catch (error) {
        this.mode = "perform"
        throw error
      }
    })
  }
}
