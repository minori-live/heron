import { useIntervalFn, useTimeoutFn } from "@vueuse/core"
import { onScopeDispose, readonly, shallowRef, toValue, watch } from "vue"
import type { MaybeRefOrGetter } from "vue"
import type { WaveformPeakWindow } from "@heron/contracts"
import { useWaveformStore } from "../stores/waveform"

interface UseClipWaveformOptions {
  id: MaybeRefOrGetter<string>
  recording: MaybeRefOrGetter<boolean>
  startFrame: MaybeRefOrGetter<number>
  endFrame: MaybeRefOrGetter<number>
  pixelWidth: MaybeRefOrGetter<number>
}

const VIEWPORT_DEBOUNCE_MS = 40
const RECORDING_POLL_MS = 50

export function useClipWaveform(options: UseClipWaveformOptions) {
  const store = useWaveformStore()
  const data = shallowRef<WaveformPeakWindow | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef("")
  let generation = 0
  let recordingLoadPending = false

  async function load(): Promise<void> {
    const recording = toValue(options.recording)
    // Live snapshots may take longer than the poll interval; keep only one request in flight.
    if (recording && recordingLoadPending) return
    const current = ++generation
    const request = {
      id: toValue(options.id),
      startFrame: Math.max(0, Math.floor(toValue(options.startFrame))),
      endFrame: Math.max(0, Math.floor(toValue(options.endFrame))),
      maxBuckets: Math.max(1, Math.min(4_096, Math.ceil(toValue(options.pixelWidth))))
    }
    if (request.endFrame < request.startFrame) return
    if (recording) recordingLoadPending = true
    loading.value = data.value === null
    try {
      const result = recording ? await store.loadRecording(request) : await store.loadAsset(request)
      if (generation !== current) return
      data.value = result
      error.value = ""
    } catch (reason) {
      if (generation !== current || toValue(options.recording)) return
      error.value = reason instanceof Error ? reason.message : "Waveform unavailable"
    } finally {
      if (recording) recordingLoadPending = false
      if (generation === current) loading.value = false
    }
  }

  // Restart-on-start debounce; useDebounceFn in VueUse 14 cannot be canceled on dispose.
  const { start: schedule, stop: cancelSchedule } = useTimeoutFn(
    () => void load(),
    VIEWPORT_DEBOUNCE_MS,
    { immediate: false }
  )
  const polling = useIntervalFn(() => void load(), RECORDING_POLL_MS, { immediate: false })

  watch(
    () => [
      toValue(options.id),
      toValue(options.recording),
      toValue(options.startFrame),
      toValue(options.endFrame)
    ],
    () => {
      generation += 1
      polling.pause()
      cancelSchedule()
      schedule()
      if (toValue(options.recording)) polling.resume()
    },
    { immediate: true }
  )
  watch(
    () => Math.ceil(toValue(options.pixelWidth)),
    () => {
      // A live clip grows with the transport. The next poll reads its latest width without
      // invalidating a useful snapshot that is already in flight.
      if (toValue(options.recording)) return
      generation += 1
      cancelSchedule()
      schedule()
    }
  )

  onScopeDispose(() => {
    generation += 1
    cancelSchedule()
    polling.pause()
  })

  return { data: readonly(data), loading: readonly(loading), error: readonly(error) }
}
