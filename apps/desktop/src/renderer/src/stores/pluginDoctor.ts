import { shallowRef } from "vue"
import { defineStore } from "pinia"
import type { DoctorCommand, DoctorSettings, DoctorSnapshot } from "@heron/contracts"
import { mutationMeta, readMeta, rpcErrorMessage } from "../rpc"

export const usePluginDoctorStore = defineStore("plugin-doctor", () => {
  const platform = window.heronDoctor.platform
  const snapshot = shallowRef<DoctorSnapshot | null>(null)
  const error = shallowRef("")
  const catalogBusy = shallowRef(false)
  let polling: ReturnType<typeof setInterval> | undefined
  let refreshing = false
  let pending = 0
  let queue: Promise<void> = Promise.resolve()
  let disposed = false

  function accept(value: DoctorSnapshot): void {
    const previous = snapshot.value
    if (
      previous?.ref.id === value.ref.id &&
      previous.report &&
      value.report &&
      previous.reportRevision === value.reportRevision
    )
      value.report = previous.report
    snapshot.value = value
  }

  async function refresh(): Promise<void> {
    if (refreshing || pending || disposed) return
    refreshing = true
    try {
      const result = await window.heronDoctor.snapshot(readMeta(snapshot.value?.ref))
      if (!disposed && !pending) {
        if (result.ok) accept(result.value)
        else error.value = rpcErrorMessage(result.error)
      }
    } finally {
      refreshing = false
    }
  }

  function command(build: DoctorCommand | ((value: DoctorSnapshot) => DoctorCommand)): void {
    pending += 1
    queue = queue
      .then(async () => {
        if (!snapshot.value || disposed) return
        const value = typeof build === "function" ? build(snapshot.value) : build
        catalogBusy.value = value.type === "refresh-catalog"
        const meta = mutationMeta(snapshot.value.ref, "plugin-doctor", snapshot.value.revision)
        let result = await window.heronDoctor.command(meta, value)
        if (!result.ok && result.error.code === "revision-conflict") {
          const authoritative = await window.heronDoctor.snapshot(readMeta(snapshot.value.ref))
          if (authoritative.ok) {
            accept(authoritative.value)
            meta.expectedRevision = authoritative.value.revision
            result = await window.heronDoctor.command(meta, value)
          }
        }
        if (disposed) return
        if (result.ok) {
          accept(result.value)
          error.value = ""
          const acknowledged = await window.heronDoctor.snapshot(
            readMeta(result.value.ref),
            meta.mutation!.operationId
          )
          if (acknowledged.ok && !disposed) accept(acknowledged.value)
        } else error.value = rpcErrorMessage(result.error)
      })
      .finally(() => {
        pending -= 1
        catalogBusy.value = false
      })
  }

  function configure(patch: Partial<DoctorSettings>): void {
    command((value) => ({ type: "configure", settings: { ...value.settings, ...patch } }))
  }

  function start(): void {
    disposed = false
    void refresh()
    polling = setInterval(() => void refresh(), 250)
  }
  function stop(): void {
    disposed = true
    if (polling) clearInterval(polling)
  }
  return { snapshot, error, catalogBusy, command, configure, platform, start, stop }
})
