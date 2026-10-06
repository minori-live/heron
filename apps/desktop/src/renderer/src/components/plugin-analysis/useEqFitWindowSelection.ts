import { onMounted, onUnmounted } from "vue"
import { storeToRefs } from "pinia"
import { usePluginAnalysisEqFitSelectionStore } from "../../stores/pluginAnalysisEqFitSelection"

export function useEqFitWindowSelection() {
  const store = usePluginAnalysisEqFitSelectionStore()
  onMounted(store.start)
  onUnmounted(store.stop)
  return { ...storeToRefs(store), select: store.select, open: store.open }
}
