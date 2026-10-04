import { createHash, randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { mkdir } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import type {
  LiveDocumentConfiguration,
  LiveCloseDisposition,
  LiveEditCommand,
  LiveSession,
  LiveHierarchy,
  LiveMidiBinding,
  LiveRuntimeSnapshot,
  LiveCaptureField,
  LiveCaptureStateTarget,
  LiveLayerId,
  MixerGraphSnapshot
} from "@heron/contracts"
import {
  applyLiveLayerCapture,
  applyLiveLayerEdit,
  captureFieldKey,
  type LiveLayerDocument
} from "@heron/project-model"
import { ProjectArchiveJournal } from "./project-archive-journal"
import { ProjectWorkingCopyStore } from "./project-working-copy-store"
import { ProjectWorkspaceOwnership } from "./project-workspace-ownership"
import { LiveWorkerClient } from "./live-worker-client"

interface LiveContext {
  worker: LiveWorkerClient
  session: LiveSession
  revision: number
  workingRoot: string
  undo: LiveHistoryEntry[]
  redo: LiveHistoryEntry[]
  /** A failed worker termination keeps ownership solely for explicit recovery cleanup. */
  closing?: boolean
}

interface LiveBaseline extends LiveLayerDocument {
  revision: number
}

type LiveHistoryEntry =
  | ({ kind: "mixer" } & LiveLayerDocument)
  | { kind: "configuration"; configuration: LiveDocumentConfiguration }

export function isLiveFilePath(path: string): boolean {
  return extname(path).toLowerCase() === ".hrl"
}

function liveFilePath(path: string): string {
  const absolute = resolve(path)
  const extension = extname(absolute).toLowerCase()
  if (!extension) return `${absolute}.hrl`
  if (extension !== ".hrl") throw new TypeError("Live document path must use .hrl")
  return absolute
}

function workspaceId(path: string): string {
  return createHash("sha256").update(resolve(path).toLowerCase()).digest("hex").slice(0, 24)
}

function comparable(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (ArrayBuffer.isView(value)) return Array.from(value as Uint8Array)
  if (Array.isArray(value)) return value.map(comparable)
  if (typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null && entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, comparable(entry)])
  )
}

/** Compare the persisted value, independent of database row order and nullable defaults. */
function samePersistedBaseline(
  expected: LiveRuntimeSnapshot,
  expectedBindings: LiveMidiBinding[],
  expectedHierarchy: LiveHierarchy,
  actual: LiveRuntimeSnapshot,
  actualBindings: LiveMidiBinding[],
  actualHierarchy: LiveHierarchy
): boolean {
  const sortId = <T extends { id: string }>(values: T[]) =>
    [...values].sort((a, b) => a.id.localeCompare(b.id))
  const normalizeLayers = <T extends LiveHierarchy["sets"][number]>(layers: T[]) =>
    sortId(layers).map((layer) => ({
      ...layer,
      overrides: [...layer.overrides].sort((a, b) =>
        captureFieldKey(a).localeCompare(captureFieldKey(b))
      ),
      pluginStates: [...(layer.pluginStates ?? [])]
        .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
        .map((override) => ({
          ...override,
          state: {
            ...override.state,
            chunks: [...override.state.chunks].sort((a, b) => a.key.localeCompare(b.key))
          }
        }))
    }))
  const normalize = (
    snapshot: LiveRuntimeSnapshot,
    bindings: LiveMidiBinding[],
    hierarchy: LiveHierarchy
  ) =>
    comparable({
      hierarchy: {
        sets: normalizeLayers(hierarchy.sets),
        patches: normalizeLayers(hierarchy.patches)
      },
      graph: {
        ...snapshot.graph,
        channels: sortId(snapshot.graph.channels),
        sends: sortId(snapshot.graph.sends),
        plugins: sortId(snapshot.graph.plugins).map((plugin) => ({
          ...plugin,
          sidechainInputs: [...plugin.sidechainInputs].sort((a, b) =>
            a.inputPortKey.localeCompare(b.inputPortKey)
          ),
          state: {
            ...plugin.state,
            chunks: [...plugin.state.chunks].sort((a, b) => a.key.localeCompare(b.key))
          }
        }))
      },
      parameterValues: [...snapshot.parameterValues].sort((a, b) =>
        `${a.pluginId}\u0000${a.parameterKey}`.localeCompare(`${b.pluginId}\u0000${b.parameterKey}`)
      ),
      bindings: sortId(bindings).map((binding) => ({
        ...binding,
        address: { ...binding.address, portName: undefined }
      }))
    })
  return isDeepStrictEqual(
    normalize(expected, expectedBindings, expectedHierarchy),
    normalize(actual, actualBindings, actualHierarchy)
  )
}

function wasRejectedBeforeCommit(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "revision-conflict" || error.code === "validation-failed")
  )
}

export class LiveDocumentService {
  private readonly workerUrl = new URL(/* @vite-ignore */ "./live-worker.mjs", import.meta.url)
  private readonly archiveJournal: ProjectArchiveJournal
  private readonly workingCopies: ProjectWorkingCopyStore<LiveDocumentConfiguration>
  private readonly workspaces = new ProjectWorkspaceOwnership<LiveContext>()

  constructor(
    userData: string,
    private readonly workerFactory: (url: URL) => LiveWorkerClient = (url) =>
      new LiveWorkerClient(url)
  ) {
    this.archiveJournal = new ProjectArchiveJournal(userData)
    this.workingCopies = new ProjectWorkingCopyStore(userData)
  }

  get current(): LiveSession | null {
    return this.workspaces.active ? structuredClone(this.workspaces.active.session) : null
  }

  get history(): { canUndo: boolean; canRedo: boolean } {
    return {
      canUndo: Boolean(this.workspaces.active?.undo.length),
      canRedo: Boolean(this.workspaces.active?.redo.length)
    }
  }

  async hasRecoverableWorkingCopy(path: string): Promise<boolean> {
    if (!isLiveFilePath(path)) throw new TypeError("Live document path must use .hrl")
    const absolute = resolve(path)
    return this.workingCopies.isRecoverable(
      this.workingCopies.root(workspaceId(absolute)),
      absolute
    )
  }

  async prepareCreate(
    configuration: LiveDocumentConfiguration,
    path: string
  ): Promise<LiveSession> {
    await this.archiveJournal.recover()
    this.workspaces.assertCanPrepare()
    const absolute = liveFilePath(path)
    const id = workspaceId(absolute)
    const context: LiveContext = {
      worker: this.workerFactory(this.workerUrl),
      session: {
        kind: "live",
        id,
        path: absolute,
        configuration,
        dirty: true,
        recoveredWorkingCopy: false
      },
      revision: 0,
      workingRoot: this.workingCopies.root(id),
      undo: [],
      redo: []
    }
    this.workspaces.stage(context)
    try {
      await this.workingCopies.reset(context.workingRoot)
      await context.worker.create(join(context.workingRoot, "pgdata"), configuration)
      await this.persistContext(context)
      await this.saveContext(context)
      return structuredClone(context.session)
    } catch (error) {
      await this.abortCandidate()
      await this.workingCopies.discard(context.workingRoot)
      throw error
    }
  }

  async prepareOpen(path: string, recoverWorkingCopy: boolean): Promise<LiveSession> {
    if (!isLiveFilePath(path)) throw new TypeError("Live document path must use .hrl")
    await this.archiveJournal.recover()
    this.workspaces.assertCanPrepare()
    const absolute = resolve(path)
    const id = workspaceId(absolute)
    const workingRoot = this.workingCopies.root(id)
    const recover =
      recoverWorkingCopy && (await this.workingCopies.isRecoverable(workingRoot, absolute))
    const worker = this.workerFactory(this.workerUrl)
    try {
      if (recover) await worker.open(join(workingRoot, "pgdata"))
      else {
        await this.workingCopies.reset(workingRoot)
        await worker.open(join(workingRoot, "pgdata"), absolute)
      }
      const session: LiveSession = {
        kind: "live",
        id,
        path: absolute,
        configuration: await worker.configuration(),
        dirty: recover,
        recoveredWorkingCopy: recover
      }
      const context: LiveContext = {
        worker,
        session,
        revision: await worker.revision(),
        workingRoot,
        undo: [],
        redo: []
      }
      this.workspaces.stage(context)
      await this.persistContext(context)
      return structuredClone(session)
    } catch (error) {
      this.workspaces.takeCandidate()
      await worker.terminate()
      throw error
    }
  }

  commitCandidate(): LiveSession {
    return structuredClone(this.workspaces.commitCandidate().session)
  }

  async abortCandidate(): Promise<void> {
    const context = this.workspaces.takeCandidate()
    await context?.worker.terminate()
  }

  async mixerSnapshot(candidate = false): Promise<MixerGraphSnapshot> {
    return (
      candidate ? this.workspaces.requireCandidate() : this.workspaces.requireActive()
    ).worker.mixerSnapshot()
  }

  async midiBindings(candidate = false): Promise<LiveMidiBinding[]> {
    return (
      candidate ? this.workspaces.requireCandidate() : this.workspaces.requireActive()
    ).worker.midiBindings()
  }

  async baseline(candidate = false): Promise<LiveBaseline> {
    const context = candidate ? this.workspaces.requireCandidate() : this.workspaces.requireActive()
    const [graph, parameterValues, bindings, hierarchy] = await Promise.all([
      context.worker.mixerSnapshot(),
      context.worker.pluginParameterValues(),
      context.worker.midiBindings(),
      context.worker.hierarchy()
    ])
    return { snapshot: { graph, parameterValues }, bindings, hierarchy, revision: context.revision }
  }

  private async commitBaseline(
    context: LiveContext,
    snapshot: LiveRuntimeSnapshot,
    bindings: LiveMidiBinding[],
    expectedRevision: number,
    hierarchy: LiveHierarchy
  ): Promise<number> {
    if (expectedRevision !== context.revision)
      throw Object.assign(new Error("Live document revision changed"), {
        code: "revision-conflict"
      })
    let revision: number
    try {
      revision = await context.worker.replaceBaseline(
        snapshot,
        bindings,
        expectedRevision,
        hierarchy
      )
    } catch (error) {
      if (wasRejectedBeforeCommit(error)) throw error
      // A worker response may be lost after PostgreSQL commits. Re-read the named result.
      const actualRevision = await context.worker.revision().catch(() => -1)
      if (actualRevision < 0 || actualRevision > expectedRevision + 1) {
        throw await this.unknownOutcome(context, "Live baseline outcome needs recovery")
      }
      if (actualRevision !== expectedRevision + 1) throw error
      const [actualGraph, actualValues, actualBindings, actualHierarchy] = await Promise.all([
        context.worker.mixerSnapshot(),
        context.worker.pluginParameterValues(),
        context.worker.midiBindings(),
        context.worker.hierarchy()
      ]).catch(async () => {
        throw await this.unknownOutcome(context, "Live baseline could not be reconciled")
      })
      if (
        !samePersistedBaseline(
          snapshot,
          bindings,
          hierarchy,
          { graph: actualGraph, parameterValues: actualValues },
          actualBindings,
          actualHierarchy
        )
      ) {
        throw await this.unknownOutcome(context, "Live baseline commit needs recovery")
      }
      revision = actualRevision
    }
    context.revision = revision
    context.session.dirty = true
    try {
      await this.persistContext(context)
    } catch (error) {
      console.error("Live baseline committed but working-copy metadata could not be updated", error)
    }
    return revision
  }

  async executeEdit(command: LiveEditCommand, expectedRevision: number): Promise<LiveBaseline> {
    const context = this.workspaces.requireActive()
    const before = await this.baseline()
    const edited = applyLiveLayerEdit(before, command)
    const revision = await this.commitBaseline(
      context,
      edited.snapshot,
      edited.bindings,
      expectedRevision,
      edited.hierarchy
    )
    context.undo.push({
      kind: "mixer",
      snapshot: before.snapshot,
      bindings: before.bindings,
      hierarchy: before.hierarchy
    })
    context.redo.length = 0
    return { ...edited, revision }
  }

  async undoEdit(expectedRevision: number): Promise<LiveBaseline> {
    const context = this.workspaces.requireActive()
    const previous = context.undo.at(-1)
    if (!previous) throw new Error("No Live edit to undo")
    if (previous.kind === "configuration") {
      const baseline = await this.baseline()
      const current = structuredClone(context.session.configuration)
      await this.commitConfiguration(context, previous.configuration, expectedRevision)
      context.undo.pop()
      context.redo.push({ kind: "configuration", configuration: current })
      baseline.snapshot.graph.sampleRate = context.session.configuration.sampleRate
      return { ...baseline, revision: context.revision }
    }
    const current = await this.baseline()
    const revision = await this.commitBaseline(
      context,
      previous.snapshot,
      previous.bindings,
      expectedRevision,
      previous.hierarchy
    )
    context.undo.pop()
    context.redo.push({
      kind: "mixer",
      snapshot: current.snapshot,
      bindings: current.bindings,
      hierarchy: current.hierarchy
    })
    return {
      snapshot: structuredClone(previous.snapshot),
      bindings: structuredClone(previous.bindings),
      hierarchy: structuredClone(previous.hierarchy),
      revision
    }
  }

  async redoEdit(expectedRevision: number): Promise<LiveBaseline> {
    const context = this.workspaces.requireActive()
    const next = context.redo.at(-1)
    if (!next) throw new Error("No Live edit to redo")
    if (next.kind === "configuration") {
      const baseline = await this.baseline()
      const current = structuredClone(context.session.configuration)
      await this.commitConfiguration(context, next.configuration, expectedRevision)
      context.redo.pop()
      context.undo.push({ kind: "configuration", configuration: current })
      baseline.snapshot.graph.sampleRate = context.session.configuration.sampleRate
      return { ...baseline, revision: context.revision }
    }
    const current = await this.baseline()
    const revision = await this.commitBaseline(
      context,
      next.snapshot,
      next.bindings,
      expectedRevision,
      next.hierarchy
    )
    context.redo.pop()
    context.undo.push({
      kind: "mixer",
      snapshot: current.snapshot,
      bindings: current.bindings,
      hierarchy: current.hierarchy
    })
    return {
      snapshot: structuredClone(next.snapshot),
      bindings: structuredClone(next.bindings),
      hierarchy: structuredClone(next.hierarchy),
      revision
    }
  }

  async commitCapture(snapshot: LiveRuntimeSnapshot, expectedRevision: number): Promise<number> {
    const context = this.workspaces.requireActive()
    const before = await this.baseline()
    const revision = await this.commitBaseline(
      context,
      snapshot,
      before.bindings,
      expectedRevision,
      before.hierarchy
    )
    context.undo.push({
      kind: "mixer",
      snapshot: before.snapshot,
      bindings: before.bindings,
      hierarchy: before.hierarchy
    })
    context.redo.length = 0
    return revision
  }

  async commitLayerCapture(
    layerId: LiveLayerId,
    frozen: LiveRuntimeSnapshot,
    available: readonly LiveCaptureField[],
    selected: readonly LiveCaptureField[],
    expectedRevision: number,
    stateTargets: readonly LiveCaptureStateTarget[] = []
  ): Promise<LiveBaseline> {
    const context = this.workspaces.requireActive()
    const before = await this.baseline()
    const next = applyLiveLayerCapture(before, layerId, frozen, available, selected, stateTargets)
    const revision = await this.commitBaseline(
      context,
      next.snapshot,
      next.bindings,
      expectedRevision,
      next.hierarchy
    )
    context.undo.push({
      kind: "mixer",
      snapshot: before.snapshot,
      bindings: before.bindings,
      hierarchy: before.hierarchy
    })
    context.redo.length = 0
    return { ...next, revision }
  }

  async updateConfiguration(
    configuration: LiveDocumentConfiguration,
    expectedRevision: number
  ): Promise<LiveSession> {
    const context = this.workspaces.requireActive()
    const previous = structuredClone(context.session.configuration)
    const session = await this.commitConfiguration(context, configuration, expectedRevision)
    context.undo.push({ kind: "configuration", configuration: previous })
    context.redo.length = 0
    return session
  }

  private async commitConfiguration(
    context: LiveContext,
    configuration: LiveDocumentConfiguration,
    expectedRevision: number
  ): Promise<LiveSession> {
    if (expectedRevision !== context.revision)
      throw Object.assign(new Error("Live document revision changed"), {
        code: "revision-conflict"
      })
    const normalized = { ...configuration, name: configuration.name.trim() }
    let revision: number
    try {
      revision = await context.worker.updateConfiguration(normalized, expectedRevision)
    } catch (error) {
      if (wasRejectedBeforeCommit(error)) throw error
      const actualRevision = await context.worker.revision().catch(() => -1)
      if (actualRevision < 0 || actualRevision > expectedRevision + 1) {
        throw await this.unknownOutcome(context, "Live configuration outcome needs recovery")
      }
      if (actualRevision !== expectedRevision + 1) throw error
      const actualConfiguration = await context.worker.configuration().catch(async () => {
        throw await this.unknownOutcome(context, "Live configuration could not be reconciled")
      })
      if (!isDeepStrictEqual(actualConfiguration, normalized)) {
        throw await this.unknownOutcome(context, "Live configuration outcome needs recovery")
      }
      revision = actualRevision
    }
    context.revision = revision
    context.session.configuration = structuredClone(normalized)
    context.session.dirty = true
    try {
      await this.persistContext(context)
    } catch (error) {
      console.error(
        "Live configuration committed but working-copy metadata could not be updated",
        error
      )
    }
    return structuredClone(context.session)
  }

  async save(operationId = `live-save:${randomUUID()}`): Promise<LiveSession> {
    const context = this.workspaces.requireActive()
    if (context.closing) {
      throw Object.assign(new Error("Live close requires recovery cleanup"), {
        code: "operation-outcome-unknown"
      })
    }
    return this.saveContext(context, operationId)
  }

  private async saveContext(
    context: LiveContext,
    operationId = `live-save:${randomUUID()}`
  ): Promise<LiveSession> {
    const target = context.session.path
    await mkdir(dirname(target), { recursive: true })
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
    await this.archiveJournal.commit({
      operationId,
      target,
      temporary,
      backup: `${target}.bak`,
      dump: (outputPath) => context.worker.dump(outputPath)
    })
    context.session.path = target
    context.session.dirty = false
    context.session.recoveredWorkingCopy = false
    try {
      await this.persistContext(context)
    } catch (error) {
      console.error("Live archive committed but working-copy metadata could not be updated", error)
    }
    return structuredClone(context.session)
  }

  private async unknownOutcome(context: LiveContext, message: string): Promise<Error> {
    // The database may have committed. Keep its working copy eligible for explicit recovery.
    context.session.dirty = true
    await this.persistContext(context).catch((error) => {
      console.error("Could not mark quarantined Live working copy for recovery", error)
    })
    return Object.assign(new Error(message), { code: "operation-outcome-unknown" })
  }

  private async persistContext(context: LiveContext): Promise<void> {
    await this.workingCopies.write(context.workingRoot, {
      id: context.session.id,
      projectPath: context.session.path,
      configuration: context.session.configuration,
      dirty: context.session.dirty
    })
  }

  async close(disposition: LiveCloseDisposition): Promise<boolean> {
    const context = this.workspaces.active
    if (!context) return true
    if (disposition === "cancel") return false
    if (context.closing && disposition !== "preserve") {
      throw Object.assign(new Error("Live close requires recovery cleanup"), {
        code: "operation-outcome-unknown"
      })
    }
    if (disposition === "preserve") {
      context.session.dirty = true
      await this.persistContext(context)
    }
    if (context.session.dirty && disposition === "save") await this.saveContext(context)
    context.closing = true
    try {
      await context.worker.terminate()
    } catch {
      // A thread may already be stopped. Retain its context without allowing document writes.
      throw await this.unknownOutcome(context, "Live worker termination needs recovery")
    }
    // Confirmed worker exit is the close commit point. Subsequent failures are cleanup failures.
    this.workspaces.takeActive()
    if (disposition === "discard") {
      try {
        // Never offer a partially removed database as a recoverable working copy.
        context.session.dirty = false
        await this.persistContext(context)
        await this.workingCopies.discard(context.workingRoot)
      } catch (error) {
        throw Object.assign(
          new Error("Closed Live working-copy cleanup failed", { cause: error }),
          {
            code: "operation-outcome-unknown"
          }
        )
      }
    }
    return true
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.workspaces.drain().map((context) => context.worker.terminate()))
  }
}
