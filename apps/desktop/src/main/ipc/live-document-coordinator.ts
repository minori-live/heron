import { randomUUID } from "node:crypto"
import { rpcFailure, rpcSuccess } from "@heron/contracts"
import type {
  LiveDocumentConfiguration,
  LiveEditCommand,
  LiveSession,
  LiveWorkspaceSnapshot,
  ProjectGraphRef,
  ProjectSessionRef,
  RpcError,
  RpcRequestMeta,
  RpcResult
} from "@heron/contracts"
import type { ApplicationStateStore, OperationService } from "../kernel"
import type { ProjectService, LiveDocumentService } from "../project"
import type { ApplicationSettingsStore } from "../settings"
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
  if (code === "revision-conflict") return code
  if (code === "operation-outcome-unknown") return "invariant-violation"
  return "resource-unavailable"
}

export class LiveDocumentCoordinator {
  private quarantined = false
  constructor(
    private readonly documents: LiveDocumentService,
    private readonly studio: ProjectService,
    private readonly state: ApplicationStateStore,
    private readonly operations: OperationService,
    private readonly settings?: ApplicationSettingsStore
  ) {}

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
      const [graph, bindings] = await Promise.all([
        this.documents.mixerSnapshot(true),
        this.documents.midiBindings(true)
      ])
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
      const session = this.documents.commitCandidate()
      committed = true
      const projectCommit = registry.commit(project, session)
      const graphCommit = registry.commit(projectGraph, {
        revision: await this.documents.baseline().then((value) => value.revision),
        graph
      })
      if (!projectCommit.ok || !graphCommit.ok) throw new Error("Could not commit Live resources")
      const workspace: LiveWorkspaceSnapshot = {
        kind: "live",
        project,
        projectGraph,
        revision: await this.documents.baseline().then((value) => value.revision),
        mode: "edit",
        history: this.documents.history,
        session,
        graph,
        bindings
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
      if (committed) await this.documents.close("discard").catch(() => undefined)
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
    if (this.quarantined) return failure(meta, "invariant-violation")
    const workspace = this.state.liveWorkspaceSnapshot()
    if (!workspace) return failure(meta)
    const invalid = validateMutationTarget(meta, workspace.project, workspace.revision)
    return invalid ?? workspace
  }

  private async updateWorkspace(
    workspace: LiveWorkspaceSnapshot,
    session: LiveSession,
    graph = workspace.graph,
    bindings = workspace.bindings,
    revision = workspace.revision
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
        edited.revision
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
    try {
      const session = await this.documents.updateConfiguration(configuration, current.revision)
      const baseline = await this.documents.baseline()
      const next = await this.updateWorkspace(
        current,
        session,
        baseline.snapshot.graph,
        baseline.bindings,
        baseline.revision
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
    disposition: "save" | "discard" | "cancel"
  ): Promise<RpcResult<boolean>> {
    const workspace = this.state.liveWorkspaceSnapshot()
    if (!workspace || !sameResourceRef(meta.target, workspace.project))
      return validationFailure(meta, "target")
    const invalid = validateMutationTarget(meta, workspace.project)
    if (invalid) return invalid
    const existing = this.begin<boolean>(meta)
    if (existing) return existing
    try {
      const closed = await this.documents.close(disposition)
      if (!closed) return this.finish(meta, rpcSuccess(meta, false))
      await this.state.resources.drop(workspace.project)
      this.state.setLiveWorkspace(null)
      this.quarantined = false
      return this.finish(meta, rpcSuccess(meta, true))
    } catch (error) {
      console.error("Live close failed", error)
      return this.finish(meta, failure(meta, codeOf(error)))
    }
  }
}
