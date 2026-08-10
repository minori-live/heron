<script setup lang="ts">
import { ref } from "vue"
import { storeToRefs } from "pinia"
import { useAudioRuntimeStore } from "../../stores/audioRuntime"
import { useAudioPreferencesStore } from "../../stores/audioPreferences"
import AudioDeviceRecoveryDialog from "./AudioDeviceRecoveryDialog.vue"

const audio = useAudioRuntimeStore()
const preferences = useAudioPreferencesStore()
const { recovery } = storeToRefs(audio)
const busy = ref(false)

async function select(inputDeviceId: string, outputDeviceId: string): Promise<void> {
  const snapshot = recovery.value
  if (!snapshot) return
  const next = { ...snapshot.previousPreferences, inputDeviceId, outputDeviceId }
  busy.value = true
  try {
    const runtime = await audio.selectRecoveryDevice(next)
    preferences.commitRecovered(next, runtime.outputBufferSize)
  } catch {
    // The store retains the canonical recovery and exposes the typed RPC failure.
  } finally {
    busy.value = false
  }
}

async function keep(): Promise<void> {
  busy.value = true
  try {
    await audio.keepRestoredDevice()
  } catch {
    // The recovery decision remains open so the user can retry.
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AudioDeviceRecoveryDialog
    v-if="recovery"
    :recovery="recovery"
    :busy="busy"
    @select="select"
    @keep="keep"
  />
</template>
