import { onMounted, onUnmounted } from "vue"
import { storeToRefs } from "pinia"
import { usePluginDoctorStore } from "../stores/pluginDoctor"

export function usePluginDoctor() {
  const store = usePluginDoctorStore()
  onMounted(store.start)
  onUnmounted(store.stop)
  return {
    ...storeToRefs(store),
    command: store.command,
    configure: store.configure,
    platform: store.platform
  }
}
