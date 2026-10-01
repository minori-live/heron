import { defineStore } from "pinia"
import { shallowRef } from "vue"
import type { LiveLayerId } from "@heron/contracts"

/** Presentation state survives panel toggles and a round trip through Settings. */
export const useLiveWorkspaceStore = defineStore("live-workspace", () => {
  const leftPanelOpen = shallowRef(true)
  const mixerOpen = shallowRef(true)
  const mixerWidth = shallowRef(520)
  const selectedLayerId = shallowRef<LiveLayerId>(null)
  function toggleMixer(): void {
    mixerOpen.value = !mixerOpen.value
  }
  return { leftPanelOpen, mixerOpen, mixerWidth, selectedLayerId, toggleMixer }
})
