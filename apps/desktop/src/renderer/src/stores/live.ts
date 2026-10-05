import { acceptHMRUpdate, defineStore } from "pinia"
import { computed, shallowRef } from "vue"
import type {
  LiveDocumentConfiguration,
  LiveCloseDisposition,
  LiveEditCommand,
  LiveCaptureField,
  LiveCapturePreview,
  LiveCaptureStateTarget,
  LiveLayerId,
  LivePerformCommand,
  LivePerformanceCommand,
  LiveWorkspaceSnapshot,
  RpcRequestMeta,
  RpcResult
} from "@heron/contracts"
import { useGlobalDialog } from "../composables/useGlobalDialog"
import { t } from "../i18n"
import { mutationMeta, readMeta, rpcErrorMessage } from "../rpc"
import { useProjectStore } from "./project"
import { useLiveWorkspaceStore } from "./liveWorkspace"
import { useAudioRuntimeStore } from "./audioRuntime"
import { livePluginRuntime } from "./live-plugin-runtime"

interface LiveMutation {
  meta: RpcRequestMeta
  quarantined?: boolean
  failureRecovery?: LiveMutation
  request(): Promise<RpcResult<unknown>>
  accept(value: unknown): boolean
}

export const useLiveStore = defineStore("live", () => {
  const projects = useProjectStore()
  const presentation = useLiveWorkspaceStore()
  const { showDialog } = useGlobalDialog()
  const workspace = shallowRef<LiveWorkspaceSnapshot | null>(null)
  const pending = shallowRef(false)
  const adjusting = shallowRef(false)
  const error = shallowRef("")
  const capturePreview = shallowRef<LiveCapturePreview | null>(null)
  const captureDialogOpen = shallowRef(false)
  const recovery = shallowRef<LiveMutation | null>(null)
  const needsReconciliation = computed(() => recovery.value !== null)
  const audioRuntime = useAudioRuntimeStore()
  const pluginFailures = livePluginRuntime(
    workspace,
    () => audioRuntime.audioHostRef?.epoch,
    () => pending.value || needsReconciliation.value,
    (failure) => {
      error.value = rpcErrorMessage(failure)
    }
  )
  const quarantined = computed(
    () => recovery.value?.quarantined === true || workspace.value?.mode === "quarantined"
  )
  const acknowledgements = new Set<string>()
  let acknowledgementEpoch: string | null = null
  const session = computed(() => workspace.value?.session ?? null)
  const isOpen = computed(() => workspace.value !== null)
  const performing = computed(() => workspace.value?.mode === "perform")
  const canUndo = computed(
    () => workspace.value?.mode === "edit" && workspace.value.history.canUndo
  )
  const canRedo = computed(
    () => workspace.value?.mode === "edit" && workspace.value.history.canRedo
  )

  function applyWorkspace(value: LiveWorkspaceSnapshot | null): void {
    const previous = workspace.value
    const selected = presentation.selectedLayerId
    if (
      !value ||
      previous?.project.id !== value.project.id ||
      previous.project.epoch !== value.project.epoch ||
      previous.project.generation !== value.project.generation
    ) {
      presentation.selectedLayerId = null
      capturePreview.value = null
    } else if (
      selected &&
      ![...value.hierarchy.sets, ...value.hierarchy.patches].some((layer) => layer.id === selected)
    ) {
      const parent = previous.hierarchy.patches.find((patch) => patch.id === selected)?.setId
      presentation.selectedLayerId = value.hierarchy.sets.some((set) => set.id === parent)
        ? parent!
        : null
    }
    workspace.value = value ? structuredClone(value) : null
    if (
      value?.mode !== "perform" ||
      (capturePreview.value &&
        (capturePreview.value.generation !== value.performance?.generation ||
          capturePreview.value.documentRevision !== value.revision))
    )
      capturePreview.value = null
    error.value = ""
  }

  async function flushAcknowledgements(): Promise<void> {
    const desktop = projects.desktopSession
    if (!desktop) return
    if (acknowledgementEpoch !== desktop.epoch) {
      acknowledgements.clear()
      acknowledgementEpoch = desktop.epoch
    }
    for (const operationId of acknowledgements) {
      const result = await window.heron.acknowledgeOperation(
        mutationMeta(desktop, "live-result-acknowledge"),
        operationId
      )
      if (!result.ok) return
      acknowledgements.delete(operationId)
    }
  }

  async function acknowledge(result: RpcResult<unknown>, mutation: LiveMutation): Promise<void> {
    if (
      !result.ok &&
      (result.error.outcome !== "not-committed" || result.error.code === "resource-busy")
    )
      return
    const desktop = projects.desktopSession
    const operationId = result.operationId ?? mutation.meta.mutation?.operationId
    if (!desktop || !operationId) return
    if (acknowledgementEpoch !== desktop.epoch) acknowledgements.clear()
    acknowledgementEpoch = desktop.epoch
    acknowledgements.add(operationId)
    await flushAcknowledgements()
  }

  async function acceptResult(
    mutation: LiveMutation,
    result: RpcResult<unknown>,
    attemptRecovery: boolean
  ): Promise<boolean> {
    if (result.ok) {
      const accepted = mutation.accept(result.value)
      recovery.value = accepted ? null : (mutation.failureRecovery ?? null)
      await acknowledge(result, mutation)
      return accepted
    }
    error.value = rpcErrorMessage(result.error)
    if (result.error.outcome === "quarantined") {
      recovery.value = { ...mutation, quarantined: true }
      error.value = t("errors.projectQuarantined")
      return false
    }
    const runningReplay =
      result.error.code === "resource-busy" &&
      result.error.details?.type === "resource-busy" &&
      result.error.details.activeOperationId === mutation.meta.mutation?.operationId
    if (result.error.outcome === "unknown" || runningReplay) {
      recovery.value = mutation
      return attemptRecovery ? recoverMutation(mutation) : false
    }
    recovery.value = mutation.failureRecovery ?? null
    if (
      result.error.code === "revision-conflict" &&
      mutation.meta.target?.kind === "project-session"
    ) {
      const failureMessage = error.value
      const refreshed = await window.heron.liveWorkspaceSnapshot(readMeta(mutation.meta.target))
      if (refreshed.ok) applyWorkspace(refreshed.value)
      error.value = failureMessage
    }
    await acknowledge(result, mutation)
    return false
  }

  async function recoverMutation(mutation: LiveMutation): Promise<boolean> {
    if (mutation.quarantined) return false
    const desktop = projects.desktopSession
    const operationId = mutation.meta.mutation?.operationId
    if (!desktop || !operationId) return false
    const status = await window.heron.operationStatus(readMeta(desktop), operationId)
    const operation = status.ok ? status.value : null
    if (!operation || operation.state !== "terminal" || operation.operationId !== operationId)
      return false
    if (operation.outcome === "quarantined") {
      recovery.value = { ...mutation, quarantined: true }
      error.value = t("errors.projectQuarantined")
      return false
    }
    if (operation.outcome !== "committed" && operation.outcome !== "not-committed") return false
    const target = mutation.meta.target
    if (
      !target ||
      operation.target.kind !== target.kind ||
      operation.target.id !== target.id ||
      operation.target.epoch !== target.epoch ||
      operation.target.generation !== target.generation
    )
      return false
    // Replay exactly the original operation only after the registry reports a terminal outcome.
    return acceptResult(mutation, await mutation.request(), false)
  }

  async function reconcile(): Promise<boolean> {
    if (pending.value) return false
    if (!recovery.value) return true
    pending.value = true
    try {
      await flushAcknowledgements()
      await recoverMutation(recovery.value)
      return recovery.value === null
    } finally {
      pending.value = false
    }
  }

  async function mutate<T>(
    meta: RpcRequestMeta,
    request: () => Promise<RpcResult<T>>,
    accept: (value: T) => boolean,
    failureRecovery?: LiveMutation
  ): Promise<boolean> {
    const mutation: LiveMutation = {
      meta,
      request,
      accept: (value) => accept(value as T),
      failureRecovery
    }
    await flushAcknowledgements()
    return acceptResult(mutation, await request(), true)
  }

  function acceptWorkspace(value: LiveWorkspaceSnapshot): boolean {
    applyWorkspace(value)
    return true
  }

  async function create(
    configuration: LiveDocumentConfiguration,
    path?: string
  ): Promise<LiveWorkspaceSnapshot | null> {
    if (pending.value) return null
    if (needsReconciliation.value) return (await reconcile()) ? workspace.value : null
    const desktop = projects.desktopSession
    if (
      !desktop ||
      workspace.value ||
      projects.isOpen ||
      pending.value ||
      needsReconciliation.value
    )
      return null
    pending.value = true
    error.value = ""
    try {
      const meta = mutationMeta(desktop, "live-create")
      const frozenConfiguration = structuredClone(configuration)
      const committed = await mutate(
        meta,
        () => window.heron.createLiveDocument(meta, frozenConfiguration, path),
        acceptWorkspace
      )
      return committed ? workspace.value : null
    } finally {
      pending.value = false
    }
  }

  async function open(path?: string): Promise<LiveWorkspaceSnapshot | null> {
    if (pending.value) return null
    if (needsReconciliation.value) return (await reconcile()) ? workspace.value : null
    const desktop = projects.desktopSession
    if (
      !desktop ||
      workspace.value ||
      projects.isOpen ||
      pending.value ||
      needsReconciliation.value
    )
      return null
    pending.value = true
    error.value = ""
    try {
      const prepared = await window.heron.prepareOpenLiveDocument(readMeta(desktop), path)
      if (!prepared.ok) {
        error.value = rpcErrorMessage(prepared.error)
        return null
      }
      if (!prepared.value) return null
      let recover = false
      if (prepared.value.recoverableWorkingCopy) {
        const choice = await showDialog<"recover" | "saved" | "cancel">({
          eyebrow: t("dialog.projectRecovery.eyebrow"),
          tone: "warning",
          title: t("dialog.projectRecovery.title"),
          description: t("dialog.projectRecovery.description"),
          detail: t("dialog.projectRecovery.detail"),
          actions: [
            { value: "recover", label: t("dialog.projectRecovery.recover"), kind: "primary" },
            { value: "saved", label: t("dialog.projectRecovery.openSaved"), kind: "secondary" },
            { value: "cancel", label: t("dialog.actions.cancel"), kind: "cancel" }
          ],
          cancelValue: "cancel"
        })
        if (!choice || choice === "cancel") return null
        recover = choice === "recover"
      }
      const meta = mutationMeta(desktop, "live-open")
      const preparedPath = prepared.value.path
      const committed = await mutate(
        meta,
        () => window.heron.openLiveDocument(meta, preparedPath, recover),
        acceptWorkspace
      )
      return committed ? workspace.value : null
    } finally {
      pending.value = false
    }
  }

  async function save(): Promise<boolean> {
    const current = workspace.value
    if (!current || pending.value || needsReconciliation.value || quarantined.value) return false
    pending.value = true
    try {
      const meta = mutationMeta(current.project, "live-save", current.revision)
      return await mutate(meta, () => window.heron.saveLiveDocument(meta), acceptWorkspace)
    } finally {
      pending.value = false
    }
  }

  async function edit(command: LiveEditCommand | "undo" | "redo"): Promise<boolean> {
    const current = workspace.value
    if (!current || current.mode !== "edit" || pending.value || needsReconciliation.value)
      return false
    pending.value = true
    try {
      const meta = mutationMeta(current.project, "live-edit", current.revision)
      const frozenCommand = structuredClone(command)
      return await mutate(
        meta,
        () =>
          frozenCommand === "undo"
            ? window.heron.undoLiveEdit(meta)
            : frozenCommand === "redo"
              ? window.heron.redoLiveEdit(meta)
              : window.heron.executeLiveEdit(meta, frozenCommand),
        acceptWorkspace
      )
    } finally {
      pending.value = false
    }
  }

  async function configure(configuration: LiveDocumentConfiguration): Promise<boolean> {
    const current = workspace.value
    if (!current || current.mode !== "edit" || pending.value || needsReconciliation.value)
      return false
    pending.value = true
    try {
      const meta = mutationMeta(current.project, "live-configure", current.revision)
      const frozenConfiguration = structuredClone(configuration)
      return await mutate(
        meta,
        () => window.heron.configureLiveDocument(meta, frozenConfiguration),
        acceptWorkspace
      )
    } finally {
      pending.value = false
    }
  }

  async function perform(command: LivePerformCommand): Promise<boolean> {
    const current = workspace.value
    if (!current || pending.value || needsReconciliation.value || quarantined.value) return false
    pending.value = true
    adjusting.value = command.type === "adjust"
    error.value = ""
    try {
      const meta = mutationMeta(current.project, `live-perform-${command.type}`, current.revision)
      const frozenCommand = structuredClone(command)
      return await mutate(
        meta,
        () => window.heron.performLive(meta, frozenCommand),
        acceptWorkspace
      )
    } finally {
      adjusting.value = false
      pending.value = false
    }
  }

  async function previewCapture(openDialog = true): Promise<boolean> {
    const current = workspace.value
    if (!current || !performing.value || pending.value || needsReconciliation.value) return false
    pending.value = true
    error.value = ""
    try {
      const meta = mutationMeta(current.project, "live-capture-preview", current.revision)
      return await mutate(
        meta,
        () => window.heron.previewLiveCapture(meta),
        (preview) => {
          if (workspace.value?.performance?.generation === preview.generation) {
            workspace.value = {
              ...workspace.value,
              performance: {
                ...workspace.value.performance,
                snapshot: structuredClone(preview.runtime),
                runtimeRevision: preview.runtimeRevision,
                uncapturedFields: structuredClone([...preview.fields, ...preview.blockedFields])
              }
            }
          }
          capturePreview.value = structuredClone(preview)
          captureDialogOpen.value = openDialog
          return true
        }
      )
    } finally {
      pending.value = false
    }
  }

  async function capture(
    fields: LiveCaptureField[],
    stateTargets?: LiveCaptureStateTarget[]
  ): Promise<boolean> {
    const preview = capturePreview.value
    if (!preview || fields.length === 0) return false
    const committed = await perform({
      type: "capture",
      captureId: preview.captureId,
      fields,
      ...(stateTargets ? { stateTargets } : {})
    })
    if (committed) {
      capturePreview.value = null
      captureDialogOpen.value = false
    }
    return committed
  }

  async function confirmPerformanceExit(): Promise<boolean> {
    if (!(await previewCapture(false))) {
      if (quarantined.value || needsReconciliation.value) return false
      const choice = await showDialog<"discard" | "cancel">({
        eyebrow: t("live.performance.mode"),
        tone: "warning",
        title: t("live.performance.unreadableTitle"),
        description: t("live.performance.unreadableDescription"),
        actions: [
          { value: "discard", label: t("live.performance.discard"), kind: "secondary" },
          { value: "cancel", label: t("dialog.actions.cancel"), kind: "cancel" }
        ],
        cancelValue: "cancel"
      })
      return choice === "discard"
    }
    const preview = capturePreview.value
    if (!preview) return false
    if (!preview.fields.length && !preview.blockedFields.length) return true
    const choice = await showDialog<"capture" | "discard" | "cancel">({
      eyebrow: t("live.performance.mode"),
      tone: "warning",
      title: t("live.performance.uncapturedTitle"),
      description: t("live.performance.uncapturedDescription"),
      detail: t("live.performance.captureThenRetry"),
      actions: [
        { value: "capture", label: t("live.performance.capture"), kind: "primary" },
        { value: "discard", label: t("live.performance.discard"), kind: "secondary" },
        { value: "cancel", label: t("dialog.actions.cancel"), kind: "cancel" }
      ],
      cancelValue: "cancel"
    })
    if (choice === "capture") captureDialogOpen.value = true
    return choice === "discard"
  }

  function samePerformance(current: LiveWorkspaceSnapshot | null): boolean {
    const next = workspace.value
    return Boolean(
      current &&
      next &&
      current.project.id === next.project.id &&
      current.project.epoch === next.project.epoch &&
      current.project.generation === next.project.generation &&
      current.revision === next.revision &&
      current.performance?.generation === next.performance?.generation &&
      next.mode === "perform"
    )
  }

  async function activate(layerId: LiveLayerId): Promise<boolean> {
    if (!performing.value || pending.value || needsReconciliation.value) return false
    const current = workspace.value
    const generation = current?.performance?.generation
    if (generation === undefined) return false
    if (current?.performance?.activeLayerId === layerId) return true
    if (!(await confirmPerformanceExit()) || !samePerformance(current)) return false
    return perform({ type: "activate", generation, layerId, disposition: "discard" })
  }

  async function leavePerform(): Promise<boolean> {
    if (!performing.value || pending.value || needsReconciliation.value) return false
    const current = workspace.value
    const generation = current?.performance?.generation
    if (generation === undefined) return false
    if (!(await confirmPerformanceExit()) || !samePerformance(current)) return false
    return perform({ type: "leave", generation, disposition: "discard" })
  }

  function adjust(
    command: LivePerformanceCommand,
    generation = workspace.value?.performance?.generation
  ): Promise<boolean> {
    if (
      !performing.value ||
      generation === undefined ||
      generation !== workspace.value?.performance?.generation
    )
      return Promise.resolve(false)
    return perform({ type: "adjust", generation, command })
  }

  async function close(): Promise<boolean> {
    if (pending.value) return false
    const preserve = quarantined.value
    const preserveRecovery = preserve ? recovery.value : null
    if (!preserve && needsReconciliation.value && !(await reconcile())) return false
    if (!preserve && performing.value && !(await leavePerform())) return false
    const current = workspace.value
    if (!current) return !needsReconciliation.value
    let disposition: LiveCloseDisposition = preserve ? "preserve" : "discard"
    if (!preserve && current.session.dirty) {
      const choice = await showDialog<"save" | "discard" | "cancel">({
        eyebrow: t("dialog.saveBeforeClose.eyebrow"),
        tone: "warning",
        title: t("dialog.saveBeforeClose.title"),
        description: t("dialog.saveBeforeClose.description", {
          name: current.session.configuration.name
        }),
        detail: t("dialog.saveBeforeClose.detail"),
        actions: [
          { value: "save", label: t("dialog.saveBeforeClose.save"), kind: "primary" },
          { value: "discard", label: t("dialog.saveBeforeClose.discard"), kind: "secondary" },
          { value: "cancel", label: t("dialog.actions.cancel"), kind: "cancel" }
        ],
        cancelValue: "cancel"
      })
      disposition = choice ?? "cancel"
    }
    if (disposition === "cancel") return false
    if (workspace.value !== current) return false
    pending.value = true
    try {
      const meta = mutationMeta(current.project, "live-close")
      const choice = disposition
      return await mutate(
        meta,
        () => window.heron.closeLiveDocument(meta, choice),
        (closed) => {
          if (closed) applyWorkspace(null)
          return closed
        },
        preserveRecovery ?? undefined
      )
    } finally {
      pending.value = false
    }
  }

  return {
    workspace,
    session,
    isOpen,
    canUndo,
    canRedo,
    performing,
    capturePreview,
    captureDialogOpen,
    pluginFailures,
    perform,
    activate,
    leavePerform,
    adjust,
    previewCapture,
    capture,
    pending,
    adjusting,
    needsReconciliation,
    quarantined,
    reconcile,
    error,
    applyWorkspace,
    create,
    open,
    save,
    edit,
    configure,
    close
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLiveStore, import.meta.hot))
}
