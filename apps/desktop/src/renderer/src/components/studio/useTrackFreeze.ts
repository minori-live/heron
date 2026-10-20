import { computed, shallowRef, watch } from "vue"
import { storeToRefs } from "pinia"
import type { TrackFreezeMode } from "@heron/contracts"
import { mutationMeta } from "../../rpc"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useMixerStore } from "../../stores/mixer"
import { useOperationStore } from "../../stores/operations"
import { useProjectStore } from "../../stores/project"

/** Starts, cancels, and clears track freezes, and remembers in-flight render jobs. */
export function useTrackFreeze() {
  const mixerStore = useMixerStore()
  const projectStore = useProjectStore()
  const settingsStore = useApplicationSettingsStore()
  const operationStore = useOperationStore()
  const { operations } = storeToRefs(operationStore)
  const { settings } = storeToRefs(settingsStore)
  const jobs = new Map<string, string>()
  const freezingTrackIds = shallowRef<readonly string[]>([])

  const buttonVisible = computed(() => settings.value?.trackHeaderFreezeVisible !== false)

  function publishJobs(): void {
    freezingTrackIds.value = [...jobs.values()]
  }

  watch(
    () => operations.value.map((operation) => `${operation.id}:${operation.state}`).join("|"),
    () => {
      let changed = false
      for (const operation of operations.value) {
        if (!jobs.has(operation.id) || operation.state === "running") continue
        jobs.delete(operation.id)
        changed = true
      }
      if (changed) publishJobs()
    }
  )

  async function toggle(trackId: string): Promise<void> {
    const running = [...jobs.entries()].find(([, id]) => id === trackId)
    if (running) {
      await operationStore.cancel(running[0])
      return
    }
    const track = mixerStore.graph.tracks.find((candidate) => candidate.id === trackId)
    if (!track || track.freeze?.status === "frozen") {
      if (track?.freeze) {
        await mixerStore.execute({ type: "set-track-freeze", trackId, freeze: null })
      }
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
    publishJobs()
  }

  function setMode(trackId: string, mode: TrackFreezeMode): Promise<boolean> {
    const track = mixerStore.graph.tracks.find((candidate) => candidate.id === trackId)
    if (!track || track.freeze) return Promise.resolve(false)
    return mixerStore.execute({ type: "update-track", trackId, patch: { freezeMode: mode } })
  }

  async function setButtonVisible(visible: boolean): Promise<void> {
    const previous = settings.value
    if (previous && (previous.trackHeaderFreezeVisible ?? true) === visible) return
    if (previous) settings.value = { ...previous, trackHeaderFreezeVisible: visible }
    const applied = await settingsStore.update({ trackHeaderFreezeVisible: visible })
    if (!applied && previous) settings.value = previous
  }

  return { freezingTrackIds, buttonVisible, toggle, setMode, setButtonVisible }
}
