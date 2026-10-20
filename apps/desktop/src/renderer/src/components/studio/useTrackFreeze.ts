import { computed, watch } from "vue"
import { storeToRefs } from "pinia"
import type { TrackFreezeMode } from "@heron/contracts"
import { mutationMeta } from "../../rpc"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useMixerStore } from "../../stores/mixer"
import { useOperationStore } from "../../stores/operations"
import { useProjectStore } from "../../stores/project"

/** Starts and clears track freezes. A second start waits until the shared operation finishes. */
export function useTrackFreeze() {
  const mixerStore = useMixerStore()
  const projectStore = useProjectStore()
  const settingsStore = useApplicationSettingsStore()
  const operationStore = useOperationStore()
  const { operations } = storeToRefs(operationStore)
  const { settings } = storeToRefs(settingsStore)
  const jobs = new Map<string, string>()

  const buttonVisible = computed(() => settings.value?.trackHeaderFreezeVisible !== false)

  function trackIsFreezing(trackId: string): boolean {
    return [...jobs.values()].includes(trackId)
  }

  watch(
    () => operations.value.map((operation) => `${operation.id}:${operation.state}`).join("|"),
    () => {
      const running = new Set(
        operations.value
          .filter((operation) => operation.state === "running")
          .map((operation) => operation.id)
      )
      for (const operationId of jobs.keys()) {
        if (!running.has(operationId)) jobs.delete(operationId)
      }
    }
  )

  async function unfreeze(trackId: string): Promise<void> {
    if (trackIsFreezing(trackId)) return
    const track = mixerStore.graph.tracks.find((candidate) => candidate.id === trackId)
    if (!track?.freeze) return
    await mixerStore.execute({ type: "set-track-freeze", trackId, freeze: null })
  }

  async function toggle(trackId: string): Promise<void> {
    if (trackIsFreezing(trackId)) return
    const track = mixerStore.graph.tracks.find((candidate) => candidate.id === trackId)
    if (!track) return
    if (track.freeze?.status === "frozen") {
      await unfreeze(trackId)
      return
    }
    const target = projectStore.projectGraphRef
    if (!target) return
    const result = await window.heron.startTrackFreeze(
      mutationMeta(target, "track-freeze", projectStore.projectRevision),
      { trackId }
    )
    if (!result.ok || !result.value) return
    jobs.set(result.value.operationId, trackId)
  }

  function setMode(trackId: string, mode: TrackFreezeMode): Promise<boolean> {
    const track = mixerStore.graph.tracks.find((candidate) => candidate.id === trackId)
    if (!track || track.freeze || trackIsFreezing(trackId)) return Promise.resolve(false)
    return mixerStore.execute({ type: "update-track", trackId, patch: { freezeMode: mode } })
  }

  async function setButtonVisible(visible: boolean): Promise<void> {
    const previous = settings.value
    if (previous && (previous.trackHeaderFreezeVisible ?? true) === visible) return
    if (previous) settings.value = { ...previous, trackHeaderFreezeVisible: visible }
    const applied = await settingsStore.update({ trackHeaderFreezeVisible: visible })
    if (!applied && previous) settings.value = previous
  }

  return { buttonVisible, toggle, unfreeze, setMode, setButtonVisible }
}
