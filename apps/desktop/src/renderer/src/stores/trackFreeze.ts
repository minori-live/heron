import { acceptHMRUpdate, defineStore } from "pinia"
import type { TrackFreezeStartResult } from "@heron/contracts"
import { mutationMeta } from "../rpc"
import { useProjectStore } from "./project"

/** Starts an offline track freeze through the preload bridge. */
export const useTrackFreezeStore = defineStore("track-freeze", () => {
  async function start(trackId: string): Promise<TrackFreezeStartResult | null> {
    const projectStore = useProjectStore()
    const target = projectStore.projectGraphRef
    if (!target) return null
    const result = await window.heron.startTrackFreeze(
      mutationMeta(target, "track-freeze", projectStore.projectRevision),
      { trackId }
    )
    if (!result.ok || !result.value) return null
    return result.value
  }

  return { start }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTrackFreezeStore, import.meta.hot))
}
