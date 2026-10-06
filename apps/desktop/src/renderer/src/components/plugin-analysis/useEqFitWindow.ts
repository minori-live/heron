import { onMounted, onUnmounted } from "vue"
import { storeToRefs } from "pinia"
import { usePluginAnalysisEqFitStore } from "../../stores/pluginAnalysisEqFit"

export function useEqFitWindow() {
  const store = usePluginAnalysisEqFitStore()
  onMounted(store.start)
  onUnmounted(store.stop)
  return {
    ...storeToRefs(store),
    platform: store.platform,
    windowCommand: store.windowCommand,
    refresh: store.refresh
  }
}
