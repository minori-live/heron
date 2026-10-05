import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type {
  LiveWorkspaceSnapshot,
  OperationStatusSnapshot,
  PluginRuntimeEvent,
  RpcEvent,
  RpcRequestMeta,
  RpcResult
} from "@heron/contracts"
import { IPC_PROTOCOL_VERSION } from "@heron/contracts"
import { useLiveStore } from "./live"
import { useProjectStore } from "./project"
import { useLiveWorkspaceStore } from "./liveWorkspace"
import { useAudioRuntimeStore } from "./audioRuntime"
import { useGlobalDialog } from "../composables/useGlobalDialog"

const desktop = { kind: "desktop-session" as const, id: "desktop", epoch: "epoch", generation: 1 }
const configuration = { name: "Stage", sampleRate: 48000, audio: null, enabledMidiDeviceIds: [] }
function workspace(dirty = false): LiveWorkspaceSnapshot {
  return {
    kind: "live",
    hierarchy: { sets: [], patches: [] },
    parameterValues: [],
    project: { ...desktop, kind: "project-session", id: "stage" },
    projectGraph: { ...desktop, kind: "project-graph", id: "graph" },
    revision: 4,
    mode: "edit",
    history: { canUndo: true, canRedo: false },
    bindings: [],
    graph: { sampleRate: 48000, channels: [], sends: [], plugins: [] },
    session: {
      kind: "live",
      id: "stage",
      path: "Stage.hrl",
      configuration,
      dirty,
      recoveredWorkingCopy: false
    }
  }
}
const success = <T>(value: T): RpcResult<T> => ({
  ok: true,
  requestId: "request",
  value,
  warnings: []
})
const failure = (): RpcResult<never> => ({
  ok: false,
  requestId: "request",
  error: {
    code: "resource-unavailable",
    category: "unavailable",
    outcome: "not-committed",
    retry: "safe",
    correlationId: "error",
    userMessageKey: "errors.projectUnavailable",
    details: { type: "resource-unavailable", component: "project-worker", dispatched: true }
  }
})
const unknownResult = (): RpcResult<never> => ({
  ok: false,
  requestId: "lost-reply",
  error: {
    code: "operation-timeout-unknown",
    category: "timeout-unknown",
    outcome: "unknown",
    retry: "after-reconcile",
    correlationId: "lost-reply",
    userMessageKey: "errors.operationOutcomeUnknown",
    details: { type: "operation-timeout-unknown", dispatched: true }
  }
})
function operation(
  meta: RpcRequestMeta,
  state: OperationStatusSnapshot["state"],
  outcome?: OperationStatusSnapshot["outcome"]
): RpcResult<OperationStatusSnapshot> {
  return success({
    operationId: meta.mutation!.operationId,
    target: meta.target!,
    state,
    outcome,
    acknowledged: false,
    cancellable: false
  })
}
function fixture() {
  const api = {
    createLiveDocument: vi.fn<typeof window.heron.createLiveDocument>(async () =>
      success(workspace())
    ),
    prepareOpenLiveDocument: vi.fn(async () =>
      success({ path: "Stage.hrl", recoverableWorkingCopy: true })
    ),
    openLiveDocument: vi.fn<typeof window.heron.openLiveDocument>(async () => success(workspace())),
    saveLiveDocument: vi.fn<typeof window.heron.saveLiveDocument>(async () => success(workspace())),
    executeLiveEdit: vi.fn<typeof window.heron.executeLiveEdit>(async () =>
      success(workspace(true))
    ),
    undoLiveEdit: vi.fn(async () => success(workspace())),
    redoLiveEdit: vi.fn(async () => success(workspace(true))),
    configureLiveDocument: vi.fn<typeof window.heron.configureLiveDocument>(async () =>
      success(workspace(true))
    ),
    closeLiveDocument: vi.fn<typeof window.heron.closeLiveDocument>(async () => success(true)),
    liveWorkspaceSnapshot: vi.fn<typeof window.heron.liveWorkspaceSnapshot>(async () =>
      success(workspace())
    ),
    operationStatus: vi.fn<typeof window.heron.operationStatus>(async () => success(null)),
    acknowledgeOperation: vi.fn<typeof window.heron.acknowledgeOperation>(async () => success(true))
  }
  Object.assign(window.heron, api)
  useProjectStore().applyDesktopSession(desktop)
  return { api, live: useLiveStore(), dialog: useGlobalDialog() }
}

describe("Live document store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("keeps Live processor health unchanged by operation notices while accepting process failures", () => {
    const bridge: { listener: ((event: RpcEvent<PluginRuntimeEvent>) => void) | null } = {
      listener: null
    }
    window.heron.subscribePluginRuntime = vi.fn((listener) => {
      bridge.listener = listener
      return () => {
        bridge.listener = null
      }
    })
    const { live } = fixture()
    const audio = useAudioRuntimeStore()
    audio.audioHostRef = { kind: "audio-host", id: "host", epoch: "audio-epoch", generation: 1 }
    const published = workspace()
    published.mode = "perform"
    published.performance = {
      activeLayerId: null,
      generation: 3,
      runtimeRevision: 4,
      snapshot: { graph: published.graph, parameterValues: [] },
      uncapturedFields: [],
      runtimePluginIds: { "document-plugin": "native-plugin" }
    }
    live.applyWorkspace(published)
    const health = structuredClone(audio.lifecycle)
    const event = (
      sequence: number,
      payload: PluginRuntimeEvent
    ): RpcEvent<PluginRuntimeEvent> => ({
      protocolVersion: IPC_PROTOCOL_VERSION,
      sourceEpoch: "audio-epoch",
      sequence,
      resourceRevision: 4,
      payload
    })
    const notice: PluginRuntimeEvent = {
      kind: "operation-failed",
      instanceId: "native-plugin",
      phase: "state-save",
      error: {
        code: "dependency-failed",
        category: "dependency-failed",
        outcome: "not-committed",
        retry: "never",
        correlationId: "state-save-1",
        userMessageKey: "errors.pluginOperationFailed",
        details: {
          type: "plugin-operation",
          format: "vst3",
          instanceId: "native-plugin",
          stage: "state-save",
          operation: "getState",
          result: 1
        }
      }
    }
    expect(bridge.listener).not.toBeNull()
    bridge.listener?.(event(1, notice))
    expect(live.error).not.toBe("")
    expect(live.pluginFailures).toEqual({})
    expect(audio.lifecycle).toEqual(health)
    expect(live.quarantined).toBe(false)
    expect(live.needsReconciliation).toBe(false)

    bridge.listener?.(
      event(2, {
        instanceId: "native-plugin",
        instanceGeneration: 3,
        graphRevision: 4,
        category: "plugin-rejected",
        stage: "process",
        outcome: "failed",
        recoverable: true,
        diagnosticId: "process-1",
        message: "process rejected"
      })
    )
    expect(live.pluginFailures["document-plugin"]).toMatchObject({
      instanceId: "document-plugin",
      stage: "process",
      diagnosticId: "process-1"
    })
    bridge.listener?.(event(3, notice))
    expect(live.pluginFailures["document-plugin"]).toMatchObject({
      instanceId: "document-plugin",
      stage: "process",
      diagnosticId: "process-1"
    })
    expect(audio.lifecycle).toEqual(health)
    live.error = ""
    bridge.listener?.(event(4, { ...notice, instanceId: "other-workspace-plugin" }))
    expect(live.error).toBe("")
  })

  it("keeps editing selection local and falls back after deleting its layer or replacing the document", () => {
    const { live } = fixture()
    const presentation = useLiveWorkspaceStore()
    const layered = workspace()
    layered.hierarchy = {
      sets: [{ id: "set", name: "Set", sortOrder: 0, overrides: [] }],
      patches: [{ id: "patch", setId: "set", name: "Patch", sortOrder: 0, overrides: [] }]
    }
    live.applyWorkspace(layered)
    presentation.selectedLayerId = "patch"
    live.applyWorkspace({ ...layered, revision: 5 })
    expect(presentation.selectedLayerId).toBe("patch")
    live.applyWorkspace({ ...layered, hierarchy: { sets: layered.hierarchy.sets, patches: [] } })
    expect(presentation.selectedLayerId).toBe("set")
    live.applyWorkspace(workspace())
    expect(presentation.selectedLayerId).toBeNull()
    live.applyWorkspace(layered)
    presentation.selectedLayerId = "patch"
    live.applyWorkspace({ ...layered, project: { ...layered.project, generation: 2 } })
    expect(presentation.selectedLayerId).toBeNull()
    presentation.selectedLayerId = "set"
    live.applyWorkspace(null)
    expect(presentation.selectedLayerId).toBeNull()
  })

  it("creates an isolated workspace and sends revisioned edits, history and baseline save", async () => {
    const { live, api } = fixture()
    expect(live.isOpen).toBe(false)
    expect(live.canUndo).toBe(false)
    expect(await live.create(configuration, "Stage.hrl")).toEqual(workspace())
    expect(live.session?.configuration.name).toBe("Stage")
    expect(live.canUndo).toBe(true)
    expect(live.canRedo).toBe(false)
    expect(await live.create(configuration)).toBeNull()
    expect(await live.open()).toBeNull()
    const command = { type: "set-midi-bindings" as const, bindings: [] }
    expect(await live.edit(command)).toBe(true)
    expect(api.executeLiveEdit).toHaveBeenCalledWith(
      expect.objectContaining({ target: workspace().project, expectedRevision: 4 }),
      command
    )
    expect(live.session?.dirty).toBe(true)
    expect(await live.edit("undo")).toBe(true)
    expect(live.session?.dirty).toBe(false)
    expect(await live.edit("redo")).toBe(true)
    expect(await live.configure(configuration)).toBe(true)
    expect(await live.save()).toBe(true)
    expect(live.session?.dirty).toBe(false)
    expect(await live.close()).toBe(true)
    expect(live.isOpen).toBe(false)
    expect(await live.close()).toBe(true)
    expect(await live.edit("undo")).toBe(false)
    expect(await live.configure(configuration)).toBe(false)
    expect(await live.save()).toBe(false)
  })

  it.each(["recover", "saved", "cancel"] as const)("honors recovery choice %s", async (choice) => {
    const { live, api, dialog } = fixture()
    const opening = live.open("Stage.hrl")
    await vi.waitFor(() => expect(dialog.activeDialog.value).not.toBeNull())
    expect(live.pending).toBe(true)
    expect(await live.open()).toBeNull()
    dialog.selectDialogAction(choice)
    const result = await opening
    expect(live.pending).toBe(false)
    if (choice === "cancel") {
      expect(result).toBeNull()
      expect(api.openLiveDocument).not.toHaveBeenCalled()
    } else {
      expect(result).toEqual(workspace())
      expect(api.openLiveDocument).toHaveBeenCalledWith(
        expect.objectContaining({ target: desktop }),
        "Stage.hrl",
        choice === "recover"
      )
    }
  })

  it.each(["save", "discard", "cancel"] as const)(
    "honors dirty close choice %s",
    async (choice) => {
      const { live, api, dialog } = fixture()
      live.applyWorkspace(workspace(true))
      const closing = live.close()
      expect(dialog.activeDialog.value?.actions.map((action) => action.value)).toEqual([
        "save",
        "discard",
        "cancel"
      ])
      dialog.selectDialogAction(choice)
      expect(await closing).toBe(choice !== "cancel")
      expect(live.isOpen).toBe(choice === "cancel")
      if (choice === "cancel") expect(api.closeLiveDocument).not.toHaveBeenCalled()
      else
        expect(api.closeLiveDocument).toHaveBeenCalledWith(
          expect.objectContaining({ target: workspace().project }),
          choice
        )
    }
  )

  it("retains the current baseline and reports failures for every mutating action", async () => {
    const { live, api } = fixture()
    live.applyWorkspace(workspace())
    api.executeLiveEdit.mockResolvedValueOnce(failure())
    api.saveLiveDocument.mockResolvedValueOnce(failure())
    api.configureLiveDocument.mockResolvedValueOnce(failure())
    api.closeLiveDocument.mockResolvedValueOnce(failure())
    for (const action of [
      () => live.edit({ type: "set-midi-bindings", bindings: [] }),
      () => live.save(),
      () => live.configure(configuration),
      () => live.close()
    ]) {
      expect(await action()).toBe(false)
      expect(live.workspace).toEqual(workspace())
      expect(live.error).not.toBe("")
      expect(live.pending).toBe(false)
    }
    api.closeLiveDocument.mockResolvedValueOnce(success(false))
    expect(await live.close()).toBe(false)
    expect(live.isOpen).toBe(true)
    live.pending = true
    expect(await live.save()).toBe(false)
    expect(await live.close()).toBe(false)
    live.pending = false
    live.applyWorkspace({ ...workspace(), mode: "perform" })
    expect(await live.edit("undo")).toBe(false)
    expect(await live.configure(configuration)).toBe(false)
  })

  it("handles create/open failure and cancelled preparation without retaining pending state", async () => {
    const { live, api } = fixture()
    api.createLiveDocument.mockResolvedValueOnce(failure())
    expect(await live.create(configuration)).toBeNull()
    expect(live.error).not.toBe("")
    api.prepareOpenLiveDocument.mockResolvedValueOnce(failure())
    expect(await live.open()).toBeNull()
    api.prepareOpenLiveDocument.mockResolvedValueOnce(success(null) as never)
    expect(await live.open()).toBeNull()
    api.prepareOpenLiveDocument.mockResolvedValueOnce(
      success({ path: "Stage.hrl", recoverableWorkingCopy: false })
    )
    api.openLiveDocument.mockResolvedValueOnce(failure())
    expect(await live.open()).toBeNull()
    expect(live.pending).toBe(false)
    expect(live.isOpen).toBe(false)
    useProjectStore().desktopSession = null
    expect(await live.create(configuration)).toBeNull()
    expect(await live.open()).toBeNull()
  })
})

describe("Live mutation reconciliation", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it.each(["edit", "save", "configure"] as const)(
    "replays the original committed %s after a lost reply and acknowledges the published result",
    async (kind) => {
      const { live, api } = fixture()
      live.applyWorkspace(workspace())
      const committed = { ...workspace(true), revision: 5 }
      const request =
        kind === "edit"
          ? api.executeLiveEdit
          : kind === "save"
            ? api.saveLiveDocument
            : api.configureLiveDocument
      request.mockResolvedValueOnce(unknownResult()).mockResolvedValueOnce(success(committed))
      api.operationStatus.mockImplementation(async () =>
        operation(request.mock.calls[0]![0], "terminal", "committed")
      )
      const completed =
        kind === "edit"
          ? await live.edit({ type: "create-set", setId: "set", name: "Set" })
          : kind === "save"
            ? await live.save()
            : await live.configure(configuration)
      expect(completed).toBe(true)
      expect(live.workspace).toEqual(committed)
      expect(request).toHaveBeenCalledTimes(2)
      expect(request.mock.calls[1]).toEqual(request.mock.calls[0])
      expect(api.operationStatus).toHaveBeenCalledTimes(1)
      expect(api.acknowledgeOperation).toHaveBeenCalledWith(
        expect.objectContaining({ target: desktop }),
        request.mock.calls[0]![0].mutation!.operationId
      )
      expect(live.needsReconciliation).toBe(false)
    }
  )

  it("holds the old workspace and blocks new mutations while the outcome is running, then retries the frozen command", async () => {
    const { live, api, dialog } = fixture()
    const initial = workspace(true)
    live.applyWorkspace(initial)
    const command = { type: "create-set" as const, setId: "set", name: "Original" }
    api.executeLiveEdit
      .mockResolvedValueOnce(unknownResult())
      .mockResolvedValueOnce(success({ ...initial, revision: 5 }))
    api.operationStatus.mockImplementation(async () =>
      operation(api.executeLiveEdit.mock.calls[0]![0], "running")
    )
    expect(await live.edit(command)).toBe(false)
    command.name = "Changed after dispatch"
    expect(live.needsReconciliation).toBe(true)
    expect(live.pending).toBe(false)
    expect(live.workspace).toEqual(initial)
    expect(await live.edit("undo")).toBe(false)
    expect(await live.configure(configuration)).toBe(false)
    expect(await live.save()).toBe(false)
    expect(await live.close()).toBe(false)
    expect(dialog.activeDialog.value).toBeNull()
    expect(api.executeLiveEdit).toHaveBeenCalledTimes(1)
    expect(api.acknowledgeOperation).not.toHaveBeenCalled()
    api.operationStatus.mockImplementation(async () =>
      operation(api.executeLiveEdit.mock.calls[0]![0], "terminal", "committed")
    )
    expect(await live.reconcile()).toBe(true)
    expect(api.executeLiveEdit.mock.calls[1]![1]).toMatchObject({ name: "Original" })
    expect(live.workspace?.revision).toBe(5)
    expect(live.needsReconciliation).toBe(false)
  })

  it("settles ordinary busy rejection but retains recovery for a running replay and quarantine", async () => {
    const { live, api } = fixture()
    live.applyWorkspace(workspace())
    const busy = {
      ok: false,
      requestId: "busy",
      error: {
        code: "resource-busy",
        category: "busy",
        outcome: "not-committed",
        retry: "safe",
        correlationId: "busy",
        userMessageKey: "errors.projectUnavailable",
        details: { type: "resource-busy" }
      }
    } satisfies RpcResult<never>
    api.executeLiveEdit.mockResolvedValueOnce(busy)
    expect(await live.edit({ type: "create-set", setId: "set", name: "Set" })).toBe(false)
    expect(live.needsReconciliation).toBe(false)
    expect(api.operationStatus).not.toHaveBeenCalled()
    api.executeLiveEdit.mockImplementationOnce(async (meta) => ({
      ...busy,
      error: {
        ...busy.error,
        details: { type: "resource-busy", activeOperationId: meta.mutation!.operationId }
      }
    }))
    expect(await live.edit({ type: "create-set", setId: "set", name: "Set" })).toBe(false)
    expect(live.needsReconciliation).toBe(true)
    api.operationStatus.mockImplementation(async () =>
      operation(api.executeLiveEdit.mock.calls[1]![0], "terminal", "quarantined")
    )
    expect(await live.reconcile()).toBe(false)
    expect(live.quarantined).toBe(true)
    const statusCalls = api.operationStatus.mock.calls.length
    expect(await live.reconcile()).toBe(false)
    expect(api.operationStatus).toHaveBeenCalledTimes(statusCalls)
    expect(live.workspace).toEqual(workspace())
    expect(api.executeLiveEdit).toHaveBeenCalledTimes(2)
    expect(api.acknowledgeOperation).not.toHaveBeenCalled()
  })

  it("retries a failed acknowledgement on the next operation without rolling back the committed edit", async () => {
    const { live, api } = fixture()
    live.applyWorkspace(workspace())
    api.acknowledgeOperation.mockResolvedValueOnce(failure())
    expect(await live.edit({ type: "create-set", setId: "set", name: "Set" })).toBe(true)
    expect(live.session?.dirty).toBe(true)
    const editOperation = api.executeLiveEdit.mock.calls[0]![0].mutation!.operationId
    expect(await live.save()).toBe(true)
    expect(api.acknowledgeOperation.mock.calls.map((call) => call[1])).toEqual([
      editOperation,
      editOperation,
      api.saveLiveDocument.mock.calls[0]![0].mutation!.operationId
    ])
    expect(live.needsReconciliation).toBe(false)
  })

  it("refreshes an explicit revision conflict and retains its error while keeping a valid selected layer", async () => {
    const { live, api } = fixture()
    const initial = workspace()
    initial.hierarchy.sets = [{ id: "set", name: "Set", sortOrder: 0, overrides: [] }]
    live.applyWorkspace(initial)
    useLiveWorkspaceStore().selectedLayerId = "set"
    const conflict: RpcResult<never> = {
      ok: false,
      requestId: "stale",
      error: {
        code: "revision-conflict",
        category: "conflict",
        outcome: "not-committed",
        retry: "after-reconcile",
        correlationId: "stale",
        userMessageKey: "errors.revisionConflict",
        details: { type: "revision-conflict", expectedRevision: 4, actualRevision: 5 }
      }
    }
    api.executeLiveEdit.mockResolvedValueOnce(conflict)
    api.liveWorkspaceSnapshot.mockResolvedValueOnce(success({ ...initial, revision: 5 }))
    expect(await live.edit({ type: "rename-live-layer", layerId: "set", name: "New" })).toBe(false)
    expect(api.liveWorkspaceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ target: initial.project })
    )
    expect(live.workspace?.revision).toBe(5)
    expect(useLiveWorkspaceStore().selectedLayerId).toBe("set")
    expect(live.error).not.toBe("")
    expect(live.needsReconciliation).toBe(false)
    expect(api.operationStatus).not.toHaveBeenCalled()
    expect(await live.save()).toBe(true)
    expect(api.saveLiveDocument).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 5 })
    )
  })

  it("reconciles lost create and close replies through their original lifecycle operations", async () => {
    const { live, api } = fixture()
    api.createLiveDocument
      .mockResolvedValueOnce(unknownResult())
      .mockResolvedValueOnce(success(workspace()))
    api.operationStatus.mockImplementation(async () =>
      operation(api.createLiveDocument.mock.calls[0]![0], "terminal", "committed")
    )
    expect(await live.create(configuration)).toEqual(workspace())
    expect(api.createLiveDocument.mock.calls[1]).toEqual(api.createLiveDocument.mock.calls[0])
    api.closeLiveDocument
      .mockResolvedValueOnce(unknownResult())
      .mockResolvedValueOnce(success(true))
    api.operationStatus.mockImplementation(async () =>
      operation(api.closeLiveDocument.mock.calls[0]![0], "terminal", "committed")
    )
    expect(await live.close()).toBe(true)
    expect(live.workspace).toBeNull()
    expect(api.closeLiveDocument.mock.calls[1]).toEqual(api.closeLiveDocument.mock.calls[0])
    expect(api.acknowledgeOperation).toHaveBeenCalledTimes(2)
  })

  it("uses the next lifecycle action to recover the original create without dispatching a new document request", async () => {
    const { live, api } = fixture()
    api.createLiveDocument
      .mockResolvedValueOnce(unknownResult())
      .mockResolvedValueOnce(success(workspace()))
    api.operationStatus.mockImplementation(async () =>
      operation(api.createLiveDocument.mock.calls[0]![0], "running")
    )
    expect(await live.create(configuration, "Original.hrl")).toBeNull()
    expect(live.needsReconciliation).toBe(true)
    api.operationStatus.mockImplementation(async () =>
      operation(api.createLiveDocument.mock.calls[0]![0], "terminal", "committed")
    )
    expect(await live.open("Different.hrl")).toEqual(workspace())
    expect(api.createLiveDocument.mock.calls[1]).toEqual(api.createLiveDocument.mock.calls[0])
    expect(api.prepareOpenLiveDocument).not.toHaveBeenCalled()
    expect(api.openLiveDocument).not.toHaveBeenCalled()
    expect(live.needsReconciliation).toBe(false)
  })

  it("preserves a quarantined working copy on explicit close and retains quarantine if that close fails", async () => {
    const { live, api, dialog } = fixture()
    live.applyWorkspace(workspace(true))
    api.executeLiveEdit.mockResolvedValueOnce({
      ok: false,
      requestId: "quarantine",
      error: {
        code: "invariant-violation",
        category: "invariant-violation",
        outcome: "quarantined",
        retry: "after-reconcile",
        correlationId: "quarantine",
        userMessageKey: "errors.projectQuarantined",
        details: { type: "invariant-violation", component: "project-worker" }
      }
    })
    expect(await live.edit({ type: "create-set", setId: "set", name: "Set" })).toBe(false)
    expect(live.quarantined).toBe(true)
    expect(api.operationStatus).not.toHaveBeenCalled()
    expect(api.acknowledgeOperation).not.toHaveBeenCalled()
    api.closeLiveDocument.mockResolvedValueOnce(failure())
    expect(await live.close()).toBe(false)
    expect(live.quarantined).toBe(true)
    expect(live.isOpen).toBe(true)
    expect(dialog.activeDialog.value).toBeNull()
    expect(api.closeLiveDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: workspace().project }),
      "preserve"
    )
    expect(await live.close()).toBe(true)
    expect(live.isOpen).toBe(false)
    expect(live.quarantined).toBe(false)
    expect(live.needsReconciliation).toBe(false)
    expect(api.acknowledgeOperation.mock.calls.map((call) => call[1])).not.toContain(
      api.executeLiveEdit.mock.calls[0]![0].mutation!.operationId
    )
  })
})
