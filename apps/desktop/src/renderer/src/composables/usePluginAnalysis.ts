import { onMounted, onUnmounted } from "vue"
import { storeToRefs } from "pinia"
import { usePluginAnalysisStore } from "../stores/pluginAnalysis"

export function usePluginAnalysis() {
  const store = usePluginAnalysisStore()
  onMounted(store.start)
  onUnmounted(store.stop)
  return {
    ...storeToRefs(store),
    command: store.command,
    configure: store.configure,
    platform: store.platform
  }
}
