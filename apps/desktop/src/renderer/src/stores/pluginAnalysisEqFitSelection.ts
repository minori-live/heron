import { onScopeDispose, shallowRef, watch } from "vue"
import { defineStore } from "pinia"
import type { PluginAnalysisEqFitSelection } from "@heron/contracts"
import { mutationMeta, rpcErrorMessage } from "../rpc"
import { usePluginAnalysisStore } from "./pluginAnalysis"

function selectionKey(selection: PluginAnalysisEqFitSelection | null): string {
  return selection ? JSON.stringify(selection) : ""
}

/** The analysis renderer publishes intent, never report samples, to the native child owner. */
export const usePluginAnalysisEqFitSelectionStore = defineStore(
  "plugin-analysis-eq-fit-selection",
  () => {
    const analysis = usePluginAnalysisStore()
    const source = () => analysis.snapshot
    const error = shallowRef("")
    let selected: PluginAnalysisEqFitSelection | null = null
    let sequence = 0
    let disposed = true

    function publish(open: boolean): void {
      const snapshot = source()
      if (!snapshot || disposed) return
      sequence = Math.max(sequence, snapshot.eqFitSequence ?? 0) + 1
      const current = sequence
      const selection =
        selected?.reportId === snapshot.reportId &&
        selected.reportRevision === snapshot.reportRevision &&
        snapshot.reportRevision === snapshot.revision
          ? selected
          : null
      if (open && !selection) return
      const meta = mutationMeta(snapshot.ref, "eq-fit-selection", snapshot.revision)
      const request = { sequence: current, selection, open }
      // Never hold a newer invalidation behind a slow native window load. The
      // owner rejects older sequence numbers; responses are guarded here too.
      void Promise.resolve().then(async () => {
        // Coalesce superseded local intents before crossing the process boundary.
        if (disposed || current !== sequence) return
        try {
          const result = await window.heronPluginAnalysis.setEqFitSelection(meta, request)
          if (disposed || current !== sequence) return
          error.value = result.ok ? "" : rpcErrorMessage(result.error)
        } catch {
          if (!disposed && current === sequence) error.value = "transport-unavailable"
        }
      })
    }

    function select(selection: PluginAnalysisEqFitSelection | null): void {
      if (selectionKey(selected) === selectionKey(selection)) return
      selected = selection
      publish(false)
    }

    watch(
      [
        () => source()?.ref.id,
        () => source()?.ref.epoch,
        () => source()?.ref.generation,
        () => source()?.revision,
        () => source()?.reportId,
        () => source()?.reportRevision
      ],
      () => publish(false),
      { immediate: true, flush: "sync" }
    )
    function start(): void {
      if (!disposed) return
      disposed = false
      publish(false)
    }
    function stop(): void {
      disposed = true
      sequence += 1
      selected = null
      error.value = ""
    }
    onScopeDispose(stop)
    return { error, select, open: () => publish(true), start, stop }
  }
)
