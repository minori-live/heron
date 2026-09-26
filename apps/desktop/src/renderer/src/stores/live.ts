import { acceptHMRUpdate, defineStore } from "pinia"
import { computed, shallowRef } from "vue"
import type {
  LiveDocumentConfiguration,
  LiveEditCommand,
  LiveWorkspaceSnapshot
} from "@heron/contracts"
import { useGlobalDialog } from "../composables/useGlobalDialog"
import { i18n } from "../i18n"
import { mutationMeta, readMeta, rpcErrorMessage } from "../rpc"
import { useProjectStore } from "./project"

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.global.t(key, params ?? {})
}

export const useLiveStore = defineStore("live", () => {
  const projects = useProjectStore()
  const { showDialog } = useGlobalDialog()
  const workspace = shallowRef<LiveWorkspaceSnapshot | null>(null)
  const pending = shallowRef(false)
  const error = shallowRef("")
  const session = computed(() => workspace.value?.session ?? null)
  const isOpen = computed(() => workspace.value !== null)
  const canUndo = computed(() => workspace.value?.history.canUndo ?? false)
  const canRedo = computed(() => workspace.value?.history.canRedo ?? false)

  function applyWorkspace(value: LiveWorkspaceSnapshot | null): void {
    workspace.value = value ? structuredClone(value) : null
    error.value = ""
  }

  async function create(
    configuration: LiveDocumentConfiguration,
    path?: string
  ): Promise<LiveWorkspaceSnapshot | null> {
    const desktop = projects.desktopSession
    if (!desktop || workspace.value || projects.isOpen || pending.value) return null
    pending.value = true
    error.value = ""
    try {
      const result = await window.heron.createLiveDocument(
        mutationMeta(desktop, "live-create"),
        configuration,
        path
      )
      if (!result.ok) {
        error.value = rpcErrorMessage(result.error)
        return null
      }
      applyWorkspace(result.value)
      return result.value
    } finally {
      pending.value = false
    }
  }

  async function open(path?: string): Promise<LiveWorkspaceSnapshot | null> {
    const desktop = projects.desktopSession
    if (!desktop || workspace.value || projects.isOpen || pending.value) return null
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
      const result = await window.heron.openLiveDocument(
        mutationMeta(desktop, "live-open"),
        prepared.value.path,
        recover
      )
      if (!result.ok) {
        error.value = rpcErrorMessage(result.error)
        return null
      }
      applyWorkspace(result.value)
      return result.value
    } finally {
      pending.value = false
    }
  }

  async function save(): Promise<boolean> {
    const current = workspace.value
    if (!current || pending.value) return false
    pending.value = true
    try {
      const result = await window.heron.saveLiveDocument(
        mutationMeta(current.project, "live-save", current.revision)
      )
      if (!result.ok) {
        error.value = rpcErrorMessage(result.error)
        return false
      }
      applyWorkspace(result.value)
      return true
    } finally {
      pending.value = false
    }
  }

  async function edit(command: LiveEditCommand | "undo" | "redo"): Promise<boolean> {
    const current = workspace.value
    if (!current || current.mode !== "edit" || pending.value) return false
    pending.value = true
    try {
      const meta = mutationMeta(current.project, "live-edit", current.revision)
      const result =
        command === "undo"
          ? await window.heron.undoLiveEdit(meta)
          : command === "redo"
            ? await window.heron.redoLiveEdit(meta)
            : await window.heron.executeLiveEdit(meta, command)
      if (!result.ok) {
        error.value = rpcErrorMessage(result.error)
        return false
      }
      applyWorkspace(result.value)
      return true
    } finally {
      pending.value = false
    }
  }

  async function configure(configuration: LiveDocumentConfiguration): Promise<boolean> {
    const current = workspace.value
    if (!current || current.mode !== "edit" || pending.value) return false
    pending.value = true
    try {
      const result = await window.heron.configureLiveDocument(
        mutationMeta(current.project, "live-configure", current.revision),
        configuration
      )
      if (!result.ok) {
        error.value = rpcErrorMessage(result.error)
        return false
      }
      applyWorkspace(result.value)
      return true
    } finally {
      pending.value = false
    }
  }

  async function close(): Promise<boolean> {
    const current = workspace.value
    if (!current) return true
    if (pending.value) return false
    let disposition: "save" | "discard" | "cancel" = "discard"
    if (current.session.dirty) {
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
    pending.value = true
    try {
      const result = await window.heron.closeLiveDocument(
        mutationMeta(current.project, "live-close"),
        disposition
      )
      if (!result.ok) {
        error.value = rpcErrorMessage(result.error)
        return false
      }
      if (result.value) applyWorkspace(null)
      return result.value
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
    pending,
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
