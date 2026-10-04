import { shallowRef } from "vue"
import { defineStore } from "pinia"
import type {
  PluginAnalysisCommand,
  PluginAnalysisSettings,
  PluginAnalysisSnapshot
} from "@heron/contracts"
import { mutationMeta, readMeta, rpcErrorMessage } from "../rpc"

export const usePluginAnalysisStore = defineStore("plugin-analysis", () => {
  const platform = window.heronPluginAnalysis.platform
  const snapshot = shallowRef<PluginAnalysisSnapshot | null>(null)
  const error = shallowRef("")
  const catalogBusy = shallowRef(false)
  let polling: ReturnType<typeof setInterval> | undefined
  let refreshing = false
  let pending = 0
  let queue: Promise<void> = Promise.resolve()
  let disposed = false

  function accept(value: PluginAnalysisSnapshot): void {
    const previous = snapshot.value
    // A matching run identity means an omitted or re-sent report body describes the
    // same measurement; keep object identity so plots do not rebuild. A new run has
    // a new reportId and its report is accepted as-is.
    if (
      previous?.ref.id === value.ref.id &&
      previous.report &&
      previous.reportId === value.reportId
    ) {
      value.report = previous.report
      value.comparisonReport = previous.comparisonReport
      value.differenceReport = previous.differenceReport
    }
    snapshot.value = value
  }

  async function refresh(): Promise<void> {
    if (refreshing || pending || disposed) return
    refreshing = true
    try {
      const result = await window.heronPluginAnalysis.snapshot(
        readMeta(snapshot.value?.ref),
        undefined,
        snapshot.value?.reportId ?? undefined
      )
      if (!disposed && !pending) {
        if (result.ok) accept(result.value)
        else error.value = rpcErrorMessage(result.error)
      }
    } finally {
      refreshing = false
    }
  }

  function command(
    build: PluginAnalysisCommand | ((value: PluginAnalysisSnapshot) => PluginAnalysisCommand)
  ): void {
    pending += 1
    queue = queue
      .then(async () => {
        if (!snapshot.value || disposed) return
        const value = typeof build === "function" ? build(snapshot.value) : build
        catalogBusy.value = value.type === "refresh-catalog"
        const meta = mutationMeta(snapshot.value.ref, "plugin-analysis", snapshot.value.revision)
        let result = await window.heronPluginAnalysis.command(meta, value)
        if (!result.ok && result.error.code === "revision-conflict") {
          const authoritative = await window.heronPluginAnalysis.snapshot(
            readMeta(snapshot.value.ref)
          )
          if (authoritative.ok) {
            accept(authoritative.value)
            meta.expectedRevision = authoritative.value.revision
            result = await window.heronPluginAnalysis.command(meta, value)
          }
        }
        if (disposed) return
        if (result.ok) {
          accept(result.value)
          error.value = ""
          const acknowledged = await window.heronPluginAnalysis.snapshot(
            readMeta(result.value.ref),
            meta.mutation!.operationId,
            result.value.reportId ?? undefined
          )
          if (acknowledged.ok && !disposed) accept(acknowledged.value)
        } else error.value = rpcErrorMessage(result.error)
      })
      .finally(() => {
        pending -= 1
        catalogBusy.value = false
      })
  }

  function configure(patch: Partial<PluginAnalysisSettings>): void {
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
