import { computed, onBeforeUnmount, onMounted, shallowRef, toRaw, watch } from "vue"
import { useI18n } from "vue-i18n"
import { AUDIO_BACKENDS, PROJECT_SAMPLE_RATES } from "@heron/contracts"
import type {
  AudioBackend,
  AudioBackendDescriptor,
  AudioDeviceDescriptor,
  AudioDeviceList,
  AudioPreferences,
  LiveDocumentConfiguration,
  MidiInputPort,
  MidiRuntimeResourceSnapshot
} from "@heron/contracts"
import type { UiRadioOption, UiSelectOption } from "@heron/ui"
import { useAudioRuntimeStore } from "../../stores/audioRuntime"
import { useLiveDiscoveryStore } from "../../stores/liveDiscovery"
import { rpcErrorMessage } from "../../rpc"

export function useLiveDeviceSettings(configuration: () => LiveDocumentConfiguration) {
  const { t } = useI18n()
  const runtime = useAudioRuntimeStore()
  const discovery = useLiveDiscoveryStore()
  const draft = shallowRef<LiveDocumentConfiguration>(structuredClone(toRaw(configuration())))
  const backends = shallowRef<AudioBackendDescriptor[]>([])
  const devices = shallowRef<AudioDeviceList>({ inputs: [], outputs: [] })
  const ports = shallowRef<MidiInputPort[]>([])
  const discoveryState = shallowRef<"idle" | "loading" | "ready" | "unavailable">("idle")
  const discoveryError = shallowRef("")
  const backendError = shallowRef("")
  const midiError = shallowRef("")
  let deviceGeneration = 0
  let disposed = false
  let unsubscribe: (() => void) | undefined

  watch(configuration, (value) => {
    draft.value = structuredClone(toRaw(value))
  })

  const backend = computed(() => draft.value.audio?.backend ?? "")
  const backendOptions = computed<UiRadioOption[]>(() => {
    const available = backends.value.filter((item) => item.available)
    const selected = draft.value.audio?.backend
    if (selected && !available.some((item) => item.id === selected)) {
      available.push({ id: selected, label: selected, available: false })
    }
    return available.map((item) => ({
      value: item.id,
      label: `${t(`settings.backends.${item.id}.label`)}${item.available ? "" : ` (${t("live.missing")})`}`,
      description: t(`settings.backends.${item.id}.description`)
    }))
  })

  function deviceOptions(
    available: AudioDeviceDescriptor[],
    selected: string | undefined
  ): UiSelectOption[] {
    return [
      { value: "", label: t("live.chooseDevice") },
      ...(selected && !available.some((item) => item.id === selected)
        ? [{ value: selected, label: `${selected} (${t("live.missing")})` }]
        : []),
      ...available.map((item) => ({ value: item.id, label: item.name }))
    ]
  }
  const inputOptions = computed(() =>
    deviceOptions(devices.value.inputs, draft.value.audio?.inputDeviceId)
  )
  const outputOptions = computed(() =>
    deviceOptions(devices.value.outputs, draft.value.audio?.outputDeviceId)
  )
  const midiPorts = computed(() => {
    const result = ports.value.map((port) => ({ ...port }))
    for (const id of draft.value.enabledMidiDeviceIds) {
      if (!result.some((port) => port.id === id)) {
        result.push({ id, name: id, connected: false })
      }
    }
    return result
  })
  const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(configuration()))
  const valid = computed(() => {
    const audio = draft.value.audio
    return (
      PROJECT_SAMPLE_RATES.some((rate) => rate === draft.value.sampleRate) &&
      (!audio ||
        (Boolean(audio.inputDeviceId) &&
          Boolean(audio.outputDeviceId) &&
          Number.isInteger(audio.bufferSize) &&
          audio.bufferSize >= 16 &&
          audio.bufferSize <= 16_384))
    )
  })

  function selectBackend(value: string): void {
    if (!AUDIO_BACKENDS.includes(value as AudioBackend) || value === backend.value) return
    draft.value = {
      ...draft.value,
      audio: {
        backend: value as AudioBackend,
        inputDeviceId: "",
        outputDeviceId: "",
        bufferSize: draft.value.audio?.bufferSize ?? 256
      }
    }
  }
  function updateAudio(patch: Partial<AudioPreferences>): void {
    if (draft.value.audio) {
      draft.value = { ...draft.value, audio: { ...draft.value.audio, ...patch } }
    }
  }
  function updateSampleRate(value: number | null): void {
    if (value !== null) draft.value = { ...draft.value, sampleRate: value }
  }
  function updateBufferSize(value: number | null): void {
    if (value !== null) updateAudio({ bufferSize: value })
  }
  function toggleMidiPort(id: string, enabled: boolean): void {
    const selected = new Set(draft.value.enabledMidiDeviceIds)
    if (enabled) selected.add(id)
    else selected.delete(id)
    draft.value = { ...draft.value, enabledMidiDeviceIds: [...selected] }
  }

  async function refreshDevices(): Promise<void> {
    const generation = ++deviceGeneration
    const selected = draft.value.audio?.backend
    const target = runtime.audioHostRef
    devices.value = { inputs: [], outputs: [] }
    discoveryError.value = ""
    if (!selected) {
      discoveryState.value = "idle"
      return
    }
    if (!target) {
      discoveryState.value = "unavailable"
      discoveryError.value = t("rendererErrors.engineUnavailable")
      return
    }
    discoveryState.value = "loading"
    const result = await discovery.listAudioDevices(target, selected)
    if (disposed || generation !== deviceGeneration) return
    if (!result.ok) {
      discoveryState.value = "unavailable"
      discoveryError.value = rpcErrorMessage(result.error)
      return
    }
    devices.value = result.value
    discoveryState.value = "ready"
  }

  function acceptMidi(value: MidiRuntimeResourceSnapshot): void {
    const target = runtime.midiRuntimeRef
    if (
      !target ||
      target.id !== value.runtime.id ||
      target.epoch !== value.runtime.epoch ||
      target.generation !== value.runtime.generation
    )
      return
    ports.value = value.snapshot.ports
  }
  async function refreshMidi(): Promise<void> {
    const target = runtime.midiRuntimeRef
    if (!target) return
    midiError.value = ""
    const result = await discovery.midiInputSnapshot(target)
    if (disposed) return
    if (result.ok) acceptMidi(result.value)
    else midiError.value = rpcErrorMessage(result.error)
  }
  async function refresh(): Promise<void> {
    await Promise.all([refreshDevices(), refreshMidi()])
  }

  watch(backend, () => void refreshDevices())
  watch(
    () => runtime.midiRuntimeRef,
    (target) => {
      unsubscribe?.()
      unsubscribe = target ? discovery.subscribeMidiInput(target, acceptMidi) : undefined
    },
    { immediate: true }
  )
  onMounted(async () => {
    const target = runtime.audioHostRef
    if (target) {
      const result = await discovery.listAudioBackends(target)
      if (disposed) return
      if (result.ok) backends.value = result.value
      else backendError.value = rpcErrorMessage(result.error)
    }
    await refresh()
  })
  onBeforeUnmount(() => {
    disposed = true
    deviceGeneration += 1
    unsubscribe?.()
  })

  return {
    draft,
    backend,
    backendOptions,
    inputOptions,
    outputOptions,
    midiPorts,
    discoveryState,
    discoveryError: computed(() => backendError.value || discoveryError.value),
    midiError,
    dirty,
    valid,
    selectBackend,
    updateAudio,
    updateSampleRate,
    updateBufferSize,
    toggleMidiPort,
    refresh
  }
}
