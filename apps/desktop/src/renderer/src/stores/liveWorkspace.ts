import { defineStore } from "pinia"
import { shallowRef } from "vue"

/** Presentation state survives panel toggles and a round trip through Settings. */
export const useLiveWorkspaceStore = defineStore("live-workspace", () => {
  const leftPanelOpen = shallowRef(true)
  const mixerOpen = shallowRef(true)
  const mixerWidth = shallowRef(520)
  function toggleMixer(): void {
    mixerOpen.value = !mixerOpen.value
  }
  return { leftPanelOpen, mixerOpen, mixerWidth, toggleMixer }
})
