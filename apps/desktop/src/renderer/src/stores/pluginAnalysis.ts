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
  let pollGeneration = 0

  function accept(value: PluginAnalysisSnapshot): void {
    const previous = snapshot.value
    // A matching run identity means an omitted or re-sent report body describes the
    // same measurement; keep object identity so plots do not rebuild. A new run has
    // a new reportId and its report is accepted as-is.
    if (
      previous?.ref.id === value.ref.id &&
      previous.report &&
      previous.reportId === value.reportId
    )
      value.report = previous.report
    snapshot.value = value
  }

  async function refresh(): Promise<void> {
    if (refreshing || pending || disposed) return
    refreshing = true
    const generation = pollGeneration
    try {
      const result = await window.heronPluginAnalysis.snapshot(
        readMeta(snapshot.value?.ref),
        undefined,
        snapshot.value?.reportId ?? undefined
      )
      if (!disposed && !pending && generation === pollGeneration) {
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
    // A read started before this intent cannot replace its acknowledged result,
    // even when it arrives after the command queue has drained.
    pollGeneration += 1
    queue = queue
      .then(async () => {
        if (!snapshot.value || disposed) return
        let value = typeof build === "function" ? build(snapshot.value) : build
        catalogBusy.value = value.type === "refresh-catalog"
        const meta = mutationMeta(snapshot.value.ref, "plugin-analysis", snapshot.value.revision)
        let result = await window.heronPluginAnalysis.command(meta, value)
        if (disposed) return
        if (!result.ok && result.error.code === "revision-conflict") {
          const authoritative = await window.heronPluginAnalysis.snapshot(
            readMeta(snapshot.value.ref)
          )
          if (disposed) return
          if (authoritative.ok) {
            accept(authoritative.value)
            meta.expectedRevision = authoritative.value.revision
            // A configuration builder represents a patch; preserve unrelated
            // settings from the authoritative revision when retrying it.
            value = typeof build === "function" ? build(authoritative.value) : build
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
    pollGeneration += 1
    if (polling) clearInterval(polling)
  }
  return { snapshot, error, catalogBusy, command, configure, platform, start, stop }
})
