import { randomUUID } from "node:crypto"
import { rpcFailure, rpcSuccess } from "@heron/contracts"
import type {
  LiveDocumentConfiguration,
  LiveCapturePreview,
  LiveCloseDisposition,
  LiveEditCommand,
  LivePerformCommand,
  LiveSession,
  LiveWorkspaceSnapshot,
  ProjectGraphRef,
  ProjectSessionRef,
  RpcError,
  RpcRequestMeta,
  RpcResult
} from "@heron/contracts"
import type { ApplicationStateStore, OperationService } from "../kernel"
import { LiveRuntimeFailure, type ProjectService, type LiveDocumentService } from "../project"
import type { ApplicationSettingsStore } from "../settings"
import type { LivePerformanceSession } from "./live-performance-session"
import {
  sameResourceRef,
  validateMutationTarget,
  validateReadTarget,
  validationFailure
} from "./resource-validation"

function failure(
  meta: RpcRequestMeta,
  code: RpcError["code"] = "resource-unavailable"
): RpcResult<never> {
  const correlationId = randomUUID()
  if (code === "validation-failed") return validationFailure(meta, "request")
  if (code === "invariant-violation") {
    return rpcFailure(meta, {
      code,
      category: "invariant-violation",
      outcome: "quarantined",
      retry: "after-reconcile",
      correlationId,
      userMessageKey: "errors.projectQuarantined",
      details: { type: code, component: "project-worker" }
    })
  }
  if (code === "document-format-mismatch" || code === "unsupported-document-version") {
    return rpcFailure(meta, {
      code,
      category: "validation",
      outcome: "not-committed",
      retry: "never",
      correlationId,
      userMessageKey:
        code === "document-format-mismatch"
          ? "errors.documentFormatMismatch"
          : "errors.unsupportedDocumentVersion",
      details: { type: code, kind: "live" }
    })
  }
  if (code === "revision-conflict") {
    return rpcFailure(meta, {
      code,
      category: "conflict",
      outcome: "not-committed",
      retry: "after-reconcile",
      correlationId,
      userMessageKey: "errors.revisionConflict",
      details: { type: code, expectedRevision: meta.expectedRevision ?? -1, actualRevision: -1 }
    })
  }
  return rpcFailure(meta, {
    code: "resource-unavailable",
    category: "unavailable",
    outcome: "not-committed",
    retry: "safe",
    correlationId,
    userMessageKey: "errors.projectUnavailable",
    details: { type: "resource-unavailable", component: "project-worker", dispatched: true }
  })
}

function codeOf(error: unknown): RpcError["code"] {
  if (error instanceof TypeError || error instanceof RangeError) return "validation-failed"
  const code = error && typeof error === "object" && "code" in error ? error.code : null
  if (code === "format-mismatch") return "document-format-mismatch"
  if (code === "unsupported-version") return "unsupported-document-version"
  if (code === "revision-conflict" || code === "validation-failed") return code
  if (code === "operation-outcome-unknown") return "invariant-violation"
  return "resource-unavailable"
}

export class LiveDocumentCoordinator {
  private quarantined = false
  private performancePending = 0
  private activationPending = 0
  constructor(
    private readonly documents: LiveDocumentService,
    private readonly studio: ProjectService,
    private readonly state: ApplicationStateStore,
    private readonly operations: OperationService,
    private readonly settings?: ApplicationSettingsStore,
    private readonly performance?: LivePerformanceSession
  ) {}

  private recordedResult<T>(meta: RpcRequestMeta): RpcResult<T> | null {
    const mutation = meta.mutation
    if (!mutation || !meta.target) return validationFailure(meta, "mutation")
    const found = this.operations.registry.find({
      operationId: mutation.operationId,
      idempotencyKey: mutation.idempotencyKey,
      target: meta.target
    })
    if (!found.ok) return validationFailure(meta, "operation")
    if (!found.value) return null
    if (found.value.result) return found.value.result as RpcResult<T>
    return rpcFailure(meta, {
      code: "resource-busy",
      category: "busy",
      outcome: "not-committed",
      retry: "safe",
      correlationId: randomUUID(),
      userMessageKey: "errors.projectUnavailable",
      details: { type: "resource-busy", activeOperationId: mutation.operationId }
    })
  }

  private begin<T>(meta: RpcRequestMeta): RpcResult<T> | null {
    const mutation = meta.mutation
    if (!mutation || !meta.target) return validationFailure(meta, "mutation")
    const begun = this.operations.registry.begin({
      operationId: mutation.operationId,
      idempotencyKey: mutation.idempotencyKey,
      target: meta.target
    })
    if (!begun.ok) return validationFailure(meta, "operation")
    if (begun.value.disposition === "started") return null
    if (begun.value.operation.result) return begun.value.operation.result as RpcResult<T>
    return rpcFailure(meta, {
      code: "resource-busy",
      category: "busy",
      outcome: "not-committed",
      retry: "safe",
      correlationId: randomUUID(),
      userMessageKey: "errors.projectUnavailable",
      details: { type: "resource-busy", activeOperationId: mutation.operationId }
    })
  }

  private finish<T>(meta: RpcRequestMeta, result: RpcResult<T>): RpcResult<T> {
    if (meta.mutation) {
      this.operations.registry.finish(
        meta.mutation.operationId,
        result.ok
          ? "committed"
          : result.error.outcome === "quarantined" || result.error.outcome === "unknown"
            ? "quarantined"
            : "not-committed",
        result
      )
    }
    return result
  }

  async create(
    meta: RpcRequestMeta,
    configuration: LiveDocumentConfiguration,
    path: string
  ): Promise<RpcResult<LiveWorkspaceSnapshot>> {
    return this.openCandidate(meta, () => this.documents.prepareCreate(configuration, path))
  }

  async open(
    meta: RpcRequestMeta,
    path: string,
    recover: boolean
  ): Promise<RpcResult<LiveWorkspaceSnapshot>> {
    return this.openCandidate(meta, () => this.documents.prepareOpen(path, recover))
  }

  private async openCandidate(
    meta: RpcRequestMeta,
    prepare: () => Promise<LiveSession>
  ): Promise<RpcResult<LiveWorkspaceSnapshot>> {
    const invalid = validateMutationTarget(meta, this.state.desktopSession)
    if (invalid) return invalid
    const recorded = this.recordedResult<LiveWorkspaceSnapshot>(meta)
    if (recorded) return recorded
    if (this.studio.current || this.state.workspaceSnapshot() || this.documents.current) {
      return rpcFailure(meta, {
        code: "resource-busy",
        category: "busy",
        outcome: "not-committed",
        retry: "safe",
        correlationId: randomUUID(),
        userMessageKey: "errors.projectUnavailable",
        details: { type: "resource-busy" }
      })
    }
    const existing = this.begin<LiveWorkspaceSnapshot>(meta)
    if (existing) return existing
    let project: ProjectSessionRef | null = null
    let committed = false
    try {
      const candidate = await prepare()
      const baseline = await this.documents.baseline(true)
      const { graph, parameterValues } = baseline.snapshot
      const { bindings, hierarchy, revision } = baseline
      const registry = this.state.resources
      const projectResource = registry.create({
        kind: "project-session",
        id: candidate.id,
        parent: this.state.desktopSession
      })
      if (!projectResource.ok) throw new Error("Could not allocate Live document resource")
      project = projectResource.value.ref as ProjectSessionRef
      const graphResource = registry.create({
        kind: "project-graph",
        id: `${candidate.id}:graph`,
        parent: project
      })
      if (!graphResource.ok) throw new Error("Could not allocate Live graph resource")
      const projectGraph = graphResource.value.ref as ProjectGraphRef
      const projectCommit = registry.commit(project, candidate)
      const graphCommit = registry.commit(projectGraph, {
        revision,
        graph
      })
      if (!projectCommit.ok || !graphCommit.ok) throw new Error("Could not commit Live resources")
      const session = this.documents.commitCandidate()
      committed = true
      const workspace: LiveWorkspaceSnapshot = {
        kind: "live",
        project,
        projectGraph,
        revision,
        mode: "edit",
        history: this.documents.history,
        session,
        graph,
        bindings,
        parameterValues,
        hierarchy
      }
      this.state.setLiveWorkspace(workspace)
      await this.settings
        ?.addRecent(session.path, session.configuration.name, "live")
        .catch((error) => console.error("Could not update recent Live documents", error))
      return this.finish(
        meta,
        rpcSuccess(meta, workspace, { resourceRevision: projectCommit.value.revision })
      )
    } catch (error) {
      if (committed) await this.documents.close("preserve").catch(() => undefined)
      else await this.documents.abortCandidate().catch(() => undefined)
      if (project) await this.state.resources.drop(project).catch(() => undefined)
      console.error("Live document candidate failed", error)
      return this.finish(meta, failure(meta, codeOf(error)))
    }
  }

  snapshot(meta: RpcRequestMeta): RpcResult<LiveWorkspaceSnapshot> {
    const workspace = this.state.liveWorkspaceSnapshot()
    if (!workspace) return failure(meta)
    const invalid = validateReadTarget(meta, workspace.project)
    return invalid ?? rpcSuccess(meta, workspace)
  }

  private currentMutation(
    meta: RpcRequestMeta
  ): RpcResult<LiveWorkspaceSnapshot> | LiveWorkspaceSnapshot {
    const recorded = this.recordedResult<LiveWorkspaceSnapshot>(meta)
    if (recorded) return recorded
    if (this.quarantined) return failure(meta, "invariant-violation")
    if (this.performancePending) return this.busy(meta)
    const workspace = this.state.liveWorkspaceSnapshot()
    if (!workspace) return failure(meta)
    const invalid = validateMutationTarget(meta, workspace.project)
    return invalid ?? (this.activeDocumentOperations(workspace) ? this.busy(meta) : workspace)
  }

  private activeDocumentOperations(workspace: LiveWorkspaceSnapshot): number {
    return this.operations.registry
      .snapshot()
      .filter(
        (operation) =>
          (operation.state === "running" || operation.state === "cancel-requested") &&
          sameResourceRef(operation.target, workspace.project)
      ).length
  }

  private busy(meta: RpcRequestMeta): RpcResult<never> {
    return rpcFailure(meta, {
      code: "resource-busy",
      category: "busy",
      outcome: "not-committed",
      retry: "safe",
      correlationId: randomUUID(),
      userMessageKey: "errors.resourceBusy",
      details: { type: "resource-busy" }
    })
  }

  private async updateWorkspace(
    workspace: LiveWorkspaceSnapshot,
    session: LiveSession,
    graph = workspace.graph,
    bindings = workspace.bindings,
    revision = workspace.revision,
    hierarchy = workspace.hierarchy,
    parameterValues = workspace.parameterValues
  ): Promise<LiveWorkspaceSnapshot> {
    const registry = this.state.resources
    const currentProject = registry.resolve(workspace.project)
    const currentGraph = registry.resolve(workspace.projectGraph)
    if (!currentProject.ok || !currentGraph.ok) {
      throw Object.assign(new Error("Live resources became stale after document commit"), {
        code: "operation-outcome-unknown"
      })
    }
    const projectResult = registry.update(workspace.project, currentProject.value.revision, session)
    const graphResult = registry.update(workspace.projectGraph, currentGraph.value.revision, {
      revision,
      graph
    })
    if (!projectResult.ok || !graphResult.ok) {
      throw Object.assign(new Error("Live resources could not advance after document commit"), {
        code: "operation-outcome-unknown"
      })
    }
    const next = {
      ...workspace,
      session,
      graph,
      bindings,
      revision,
      hierarchy,
      parameterValues,
      mode: this.quarantined
        ? ("quarantined" as const)
        : (this.performance?.mode ?? workspace.mode),
      performance: this.performance
        ? this.performance.performance
        : (workspace.performance ?? null),
      history: this.documents.history
    }
    this.state.setLiveWorkspace(next)
    return next
  }

  async save(meta: RpcRequestMeta): Promise<RpcResult<LiveWorkspaceSnapshot>> {
    const current = this.currentMutation(meta)
    if ("ok" in current) return current
    const existing = this.begin<LiveWorkspaceSnapshot>(meta)
    if (existing) return existing
    const invalid = validateMutationTarget(meta, current.project, current.revision)
    if (invalid) return this.finish(meta, invalid)
    try {
      const session = await this.documents.save(meta.mutation!.operationId)
      const next = await this.updateWorkspace(current, session)
      return this.finish(meta, rpcSuccess(meta, next))
    } catch (error) {
      console.error("Live save failed", error)
      if (codeOf(error) === "invariant-violation") this.quarantined = true
      return this.finish(meta, failure(meta, codeOf(error)))
    }
  }

  async edit(
    meta: RpcRequestMeta,
    command: LiveEditCommand | "undo" | "redo"
  ): Promise<RpcResult<LiveWorkspaceSnapshot>> {
    const current = this.currentMutation(meta)
    if ("ok" in current) return current
    if (current.mode !== "edit") return validationFailure(meta, "mode")
    const existing = this.begin<LiveWorkspaceSnapshot>(meta)
    if (existing) return existing
    const invalid = validateMutationTarget(meta, current.project, current.revision)
    if (invalid) return this.finish(meta, invalid)
    try {
      const edited =
        command === "undo"
          ? await this.documents.undoEdit(current.revision)
          : command === "redo"
            ? await this.documents.redoEdit(current.revision)
            : await this.documents.executeEdit(command, current.revision)
      const session = this.documents.current
      if (!session) throw new Error("Live document closed during Edit")
      const next = await this.updateWorkspace(
        current,
        session,
        edited.snapshot.graph,
        edited.bindings,
        edited.revision,
        edited.hierarchy,
        edited.snapshot.parameterValues
      )
      return this.finish(meta, rpcSuccess(meta, next))
    } catch (error) {
      console.error("Live Edit failed", error)
      if (codeOf(error) === "invariant-violation") this.quarantined = true
      return this.finish(meta, failure(meta, codeOf(error)))
    }
  }

  async configure(
    meta: RpcRequestMeta,
    configuration: LiveDocumentConfiguration
  ): Promise<RpcResult<LiveWorkspaceSnapshot>> {
    const current = this.currentMutation(meta)
    if ("ok" in current) return current
    if (current.mode !== "edit") return validationFailure(meta, "mode")
    const existing = this.begin<LiveWorkspaceSnapshot>(meta)
    if (existing) return existing
    const invalid = validateMutationTarget(meta, current.project, current.revision)
    if (invalid) return this.finish(meta, invalid)
    try {
      const session = await this.documents.updateConfiguration(configuration, current.revision)
      const baseline = await this.documents.baseline()
      const next = await this.updateWorkspace(
        current,
        session,
        baseline.snapshot.graph,
        baseline.bindings,
        baseline.revision,
        baseline.hierarchy,
        baseline.snapshot.parameterValues
      )
      return this.finish(meta, rpcSuccess(meta, next))
    } catch (error) {
      console.error("Live configuration failed", error)
      if (codeOf(error) === "invariant-violation") this.quarantined = true
      return this.finish(meta, failure(meta, codeOf(error)))
    }
  }

  async close(
    meta: RpcRequestMeta,
    disposition: LiveCloseDisposition
  ): Promise<RpcResult<boolean>> {
    const recorded = this.recordedResult<boolean>(meta)
    if (recorded) return recorded
    const workspace = this.state.liveWorkspaceSnapshot()
    if (!workspace || !sameResourceRef(meta.target, workspace.project))
      return validationFailure(meta, "target")
    const invalid = validateMutationTarget(meta, workspace.project)
    if (invalid) return invalid
    if (this.performancePending || this.activeDocumentOperations(workspace)) return this.busy(meta)
    if (workspace.mode !== "edit" && !this.quarantined && disposition !== "cancel")
      return validationFailure(meta, "mode")
    if (this.quarantined && disposition !== "preserve" && disposition !== "cancel")
      return failure(meta, "invariant-violation")
    const existing = this.begin<boolean>(meta)
    if (existing) return existing
    let documentClosed = false
    try {
      if (disposition !== "cancel") await this.performance?.close()
      const closed = await this.documents.close(disposition)
      if (!closed) return this.finish(meta, rpcSuccess(meta, false))
      documentClosed = true
      const dropped = await this.state.resources.drop(workspace.project)
      if (!dropped.ok || dropped.value.quarantined.length) {
        throw new Error("Closed Live resources require cleanup")
      }
      this.state.setLiveWorkspace(null)
      this.quarantined = false
      return this.finish(meta, rpcSuccess(meta, true))
    } catch (error) {
      console.error("Live close failed", error)
      if (documentClosed || (disposition !== "cancel" && !this.documents.current)) {
        this.state.resources.quarantine(workspace.project)
        this.state.setLiveWorkspace(null)
        this.quarantined = false
        return this.finish(
          meta,
          rpcSuccess(meta, true, {
            warnings: [
              {
                code: "live-resource-cleanup-quarantined",
                userMessageKey: "errors.internalInvariant",
                resource: workspace.project
              }
            ]
          })
        )
      }
      if (error instanceof LiveRuntimeFailure) {
        if (error.error.outcome !== "not-committed") this.quarantined = true
        if (this.quarantined) this.state.setLiveWorkspace({ ...workspace, mode: "quarantined" })
        return this.finish(meta, rpcFailure(meta, error.error))
      }
      if (codeOf(error) === "invariant-violation") {
        this.quarantined = true
        this.state.setLiveWorkspace({ ...workspace, mode: "quarantined" })
      }
      return this.finish(meta, failure(meta, codeOf(error)))
    }
  }

  async perform(
    meta: RpcRequestMeta,
    command: LivePerformCommand
  ): Promise<RpcResult<LiveWorkspaceSnapshot>> {
    return this.performanceOperation(
      meta,
      command.type === "activate",
      async (workspace, committed) => {
        if (
          command.type === "enter" ||
          (command.type === "leave" && command.disposition !== "cancel")
        ) {
          this.state.setLiveWorkspace({
            ...workspace,
            mode: command.type === "enter" ? "preparing-perform" : "leaving-perform"
          })
        }
        await this.performance!.execute(workspace, command)
        committed()
        return this.refreshPerformanceWorkspace(
          command.type === "enter" || command.type === "capture"
        )
      },
      "generation" in command ? command.generation : undefined
    )
  }

  async previewCapture(meta: RpcRequestMeta): Promise<RpcResult<LiveCapturePreview>> {
    return this.performanceOperation(meta, false, async (_workspace, committed) => {
      const preview = await this.performance!.previewCapture()
      committed()
      await this.refreshPerformanceWorkspace()
      return preview
    })
  }

  private async refreshPerformanceWorkspace(readBaseline = false): Promise<LiveWorkspaceSnapshot> {
    const workspace = this.state.liveWorkspaceSnapshot()
    const session = this.documents.current
    if (!workspace || !session) throw new TypeError("Live document is closed")
    if (!readBaseline) {
      const next: LiveWorkspaceSnapshot = {
        ...workspace,
        session,
        mode: this.quarantined ? "quarantined" : (this.performance?.mode ?? workspace.mode),
        performance: this.performance?.performance ?? null,
        history: this.documents.history
      }
      this.state.setLiveWorkspace(next)
      return next
    }
    const baseline = await this.documents.baseline()
    return this.updateWorkspace(
      workspace,
      session,
      baseline.snapshot.graph,
      baseline.bindings,
      baseline.revision,
      baseline.hierarchy,
      baseline.snapshot.parameterValues
    )
  }

  private async performanceOperation<T>(
    meta: RpcRequestMeta,
    activating: boolean,
    run: (workspace: LiveWorkspaceSnapshot, committed: () => void) => Promise<T>,
    generation?: number
  ): Promise<RpcResult<T>> {
    const recorded = this.recordedResult<T>(meta)
    if (recorded) return recorded
    if (this.quarantined) return failure(meta, "invariant-violation")
    const workspace = this.state.liveWorkspaceSnapshot()
    if (!workspace || !this.performance) return failure(meta)
    const invalid = validateMutationTarget(meta, workspace.project, workspace.revision)
    if (invalid) return invalid
    if (generation !== undefined && this.performance.performance?.generation !== generation) {
      return validationFailure(meta, "generation")
    }
    if (
      this.activeDocumentOperations(workspace) > 0 &&
      (!activating || this.activeDocumentOperations(workspace) !== this.activationPending)
    )
      return this.busy(meta)
    const existing = this.begin<T>(meta)
    if (existing) return existing
    this.performancePending += 1
    if (activating) this.activationPending += 1
    let committed = false
    try {
      return this.finish(
        meta,
        rpcSuccess(
          meta,
          await run(workspace, () => {
            committed = true
          })
        )
      )
    } catch (error) {
      console.error("Live performance operation failed", error)
      const result =
        error instanceof LiveRuntimeFailure
          ? rpcFailure(meta, error.error)
          : failure(meta, codeOf(error))
      if (committed || (!result.ok && result.error.outcome !== "not-committed"))
        this.quarantined = true
      try {
        // Enter can commit synchronized state before runtime preparation fails.
        await this.refreshPerformanceWorkspace(true)
      } catch {
        this.quarantined = true
      }
      if (this.quarantined) {
        const current = this.state.liveWorkspaceSnapshot()
        if (current) this.state.setLiveWorkspace({ ...current, mode: "quarantined" })
        return this.finish(meta, failure(meta, "invariant-violation"))
      }
      return this.finish(meta, result)
    } finally {
      this.performancePending -= 1
      if (activating) this.activationPending -= 1
    }
  }
}
