import { acceptHMRUpdate, defineStore } from "pinia"
import { onScopeDispose, shallowRef } from "vue"
import type { ApplicationUpdateCommand, ApplicationUpdateSnapshot } from "@heron/contracts"
import { mutationMeta, readMeta, rpcErrorMessage } from "../rpc"
import { useProjectStore } from "./project"
import { useStudioWorkflowStore } from "./studioWorkflow"
import { useTransportStore } from "./transport"
import { useOperationStore } from "./operations"
import { useRecordingStore } from "./recording"
import { i18n } from "../i18n"

export const useApplicationUpdatesStore = defineStore("application-updates", () => {
  const project = useProjectStore()
  const snapshot = shallowRef<ApplicationUpdateSnapshot | null>(null)
  const busy = shallowRef(false)
  const error = shallowRef("")
  let unsubscribe: (() => void) | null = null

  function accept(value: ApplicationUpdateSnapshot): void {
    if (!snapshot.value || value.revision >= snapshot.value.revision) snapshot.value = value
  }

  async function refresh(): Promise<void> {
    if (!project.desktopSession) return
    const result = await window.heron.updateSnapshot(readMeta(project.desktopSession))
    if (result.ok) accept(result.value)
    else error.value = rpcErrorMessage(result.error)
  }

  async function connect(): Promise<void> {
    if (!unsubscribe) {
      unsubscribe = window.heron.subscribeUpdates((event) => {
        if (event.sourceEpoch === project.desktopSession?.epoch) accept(event.payload)
      })
    }
    await refresh()
  }

  async function send(command: ApplicationUpdateCommand): Promise<void> {
    const target = project.desktopSession
    if (!target || !snapshot.value) return
    const result = await window.heron.updateCommand(
      mutationMeta(target, `application-update-${command}`, snapshot.value.revision),
      command
    )
    if (result.ok) {
      accept(result.value.snapshot)
      if (!result.value.accepted)
        error.value = i18n.global.t(`updates.rejected.${result.value.reason}`)
    } else error.value = rpcErrorMessage(result.error)
    // A response/event can be lost or arrive out of order. Read the authoritative state.
    await refresh()
  }

  async function command(action: ApplicationUpdateCommand): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = ""
    try {
      await send(action)
    } finally {
      busy.value = false
    }
  }

  async function install(): Promise<void> {
    if (busy.value || snapshot.value?.phase !== "ready") return
    busy.value = true
    error.value = ""
    try {
      if (
        useTransportStore().snapshot.state !== "stopped" ||
        useRecordingStore().lifecycle.status !== "idle" ||
        useOperationStore().operations.some((operation) => operation.state === "running")
      ) {
        error.value = i18n.global.t("updates.rejected.busy")
        return
      }
      if (project.session && !(await useStudioWorkflowStore().closeProject())) return
      await refresh()
      await send("install")
    } finally {
      busy.value = false
    }
  }

  onScopeDispose(() => {
    unsubscribe?.()
  })
  return { snapshot, busy, error, connect, refresh, command, install }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useApplicationUpdatesStore, import.meta.hot))
