import { computed, ref, watch, type Ref } from "vue"
import type { AudioDeviceRecoverySnapshot, AudioPreferences } from "@heron/contracts"

export function useAudioDeviceRecoveryDraft(recovery: Ref<AudioDeviceRecoverySnapshot | null>) {
  const inputDeviceId = ref("")
  const outputDeviceId = ref("")
  let recoveryKey = ""

  watch(
    recovery,
    (snapshot) => {
      const nextKey = snapshot
        ? `${snapshot.recovery.epoch}:${snapshot.recovery.id}:${snapshot.recovery.generation}`
        : ""
      if (!snapshot || nextKey === recoveryKey) return
      recoveryKey = nextKey
      inputDeviceId.value = snapshot.previousPreferences.inputDeviceId
      outputDeviceId.value = snapshot.previousPreferences.outputDeviceId
    },
    { immediate: true }
  )

  const inputOptions = computed(() => options("input"))
  const outputOptions = computed(() => options("output"))
  const valid = computed(() => {
    const snapshot = recovery.value
    if (!snapshot) return false
    return (
      snapshot.candidates.inputs.some((item) => item.id === inputDeviceId.value) &&
      snapshot.candidates.outputs.some((item) => item.id === outputDeviceId.value) &&
      (snapshot.previousPreferences.backend !== "asio" ||
        inputDeviceId.value === outputDeviceId.value)
    )
  })

  function options(
    direction: "input" | "output"
  ): Array<{ value: string; label: string; disabled?: boolean }> {
    const snapshot = recovery.value
    if (!snapshot) return []
    const selected = direction === "input" ? inputDeviceId.value : outputDeviceId.value
    const devices = direction === "input" ? snapshot.candidates.inputs : snapshot.candidates.outputs
    const result: Array<{ value: string; label: string; disabled?: boolean }> = devices.map(
      (item) => ({ value: item.id, label: item.name })
    )
    if (selected && !devices.some((item) => item.id === selected)) {
      result.unshift({ value: selected, label: `${selected} — unavailable`, disabled: true })
    }
    return result
  }

  function selectInput(value: string): void {
    inputDeviceId.value = value
    if (recovery.value?.previousPreferences.backend === "asio") outputDeviceId.value = value
  }

  function selectOutput(value: string): void {
    outputDeviceId.value = value
    if (recovery.value?.previousPreferences.backend === "asio") inputDeviceId.value = value
  }

  function preferences(): AudioPreferences | null {
    const snapshot = recovery.value
    if (!snapshot || !valid.value) return null
    return {
      ...snapshot.previousPreferences,
      inputDeviceId: inputDeviceId.value,
      outputDeviceId: outputDeviceId.value
    }
  }

  return {
    inputDeviceId,
    outputDeviceId,
    inputOptions,
    outputOptions,
    valid,
    selectInput,
    selectOutput,
    preferences
  }
}
