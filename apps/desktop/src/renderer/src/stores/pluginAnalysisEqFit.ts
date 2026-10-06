import { onScopeDispose, shallowRef } from "vue"
import { defineStore } from "pinia"
import type {
  ApplicationWindowCommandId,
  PluginAnalysisEqFitSnapshot,
  PluginAnalysisEqFitWindowCommand,
  ResourceRef
} from "@heron/contracts"
import { mutationMeta, readMeta, rpcErrorMessage } from "../rpc"

/** Read-only report ownership remains in the analysis service; this window owns its fit. */
export const usePluginAnalysisEqFitStore = defineStore("plugin-analysis-eq-fit", () => {
  const snapshot = shallowRef<PluginAnalysisEqFitSnapshot | null>(null)
  const error = shallowRef("")
  const windowError = shallowRef("")
  const platform = window.heronPluginAnalysisEqFit.platform
  let timer: ReturnType<typeof setInterval> | undefined
  let reading: number | null = null
  let disposed = true
  let generation = 0
  let lifecycle = 0
  const acknowledgements: string[] = []
  let lastRef: ResourceRef<"plugin-analysis"> | undefined
  let lastMaximized = false
  let commandQueue: Promise<void> = Promise.resolve()

  async function refresh(): Promise<void> {
    if (disposed || reading !== null) return
    const current = generation
    reading = current
    const previous = snapshot.value
    const acknowledged = acknowledgements[0]
    try {
      const result = await window.heronPluginAnalysisEqFit.snapshot(
        readMeta(previous?.ref ?? lastRef),
        previous?.reportId ?? undefined,
        acknowledged
      )
      if (disposed || current !== generation) return
      if (!result.ok) {
        snapshot.value = null
        error.value = rpcErrorMessage(result.error)
        return
      }
      const next = result.value
      if (acknowledgements[0] === acknowledged) acknowledgements.shift()
      lastRef = next.ref
      lastMaximized = next.maximized
      const sameReport =
        next.selection !== null &&
        previous?.ref.id === next.ref.id &&
        previous.ref.epoch === next.ref.epoch &&
        previous.ref.generation === next.ref.generation &&
        previous.reportId !== null &&
        previous.reportId === next.reportId
      snapshot.value = !next.selection
        ? { ...next, report: null, comparisonReport: null }
        : sameReport
          ? {
              ...next,
              report: next.report ?? previous.report,
              comparisonReport: next.comparisonReport ?? previous.comparisonReport
            }
          : next
      error.value = ""
    } catch {
      if (!disposed && current === generation) {
        snapshot.value = null
        error.value = "transport-unavailable"
      }
    } finally {
      if (reading === current) reading = null
    }
  }

  async function executeWindowCommand(command: ApplicationWindowCommandId): Promise<void> {
    const current = snapshot.value
    const target = current?.ref ?? lastRef
    if (!target || disposed) return
    generation += 1
    const currentLifecycle = lifecycle
    const action: PluginAnalysisEqFitWindowCommand =
      command === "window.minimize"
        ? { type: "minimize" }
        : command === "window.toggle-maximize"
          ? { type: "set-maximized", maximized: !(current?.maximized ?? lastMaximized) }
          : { type: "close" }
    try {
      const meta = mutationMeta(target, "eq-fit-window")
      const result = await window.heronPluginAnalysisEqFit.window(meta, action)
      // A stopped renderer scope does not destroy the native receipt owner.
      // Retain successful receipts for acknowledgement after a local remount.
      if (result.ok) acknowledgements.push(meta.mutation!.operationId)
      if (disposed || currentLifecycle !== lifecycle) return
      if (!result.ok) windowError.value = rpcErrorMessage(result.error)
      else {
        windowError.value = ""
        lastMaximized = result.value.maximized
        if (snapshot.value)
          snapshot.value = { ...snapshot.value, maximized: result.value.maximized }
      }
    } catch {
      if (!disposed && currentLifecycle === lifecycle) windowError.value = "transport-unavailable"
    }
  }
  function windowCommand(command: ApplicationWindowCommandId): void {
    const currentLifecycle = lifecycle
    commandQueue = commandQueue.then(() => {
      if (disposed || currentLifecycle !== lifecycle) return
      return executeWindowCommand(command)
    })
  }

  function start(): void {
    if (!disposed) return
    disposed = false
    lifecycle += 1
    void refresh()
    timer = setInterval(() => void refresh(), 250)
  }
  function stop(): void {
    disposed = true
    generation += 1
    lifecycle += 1
    if (timer) clearInterval(timer)
    timer = undefined
    reading = null
    snapshot.value = null
    error.value = ""
    windowError.value = ""
    commandQueue = Promise.resolve()
  }
  onScopeDispose(stop)
  return { snapshot, error, windowError, platform, windowCommand, refresh, start, stop }
})
