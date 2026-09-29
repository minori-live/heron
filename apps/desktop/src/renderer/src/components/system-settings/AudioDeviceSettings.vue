<script setup lang="ts">
import { useI18n } from "vue-i18n"
import type { AudioPreferences, AudioRuntimeSnapshot } from "@heron/contracts"
import SettingsPage from "../settings/SettingsPage.vue"
import AudioBackendSection from "./AudioBackendSection.vue"
import AudioBufferLatencySections from "./AudioBufferLatencySections.vue"
import AudioDeviceSections from "./AudioDeviceSections.vue"
import { useAudioDeviceOptions } from "./useAudioDeviceOptions"

const { t } = useI18n()

const props = defineProps<{
  runtime: AudioRuntimeSnapshot
  applyError: string
}>()
const preferences = defineModel<AudioPreferences>({ required: true })
const emit = defineEmits<{ validityChange: [valid: boolean] }>()

const {
  discoveryState,
  discoveryError,
  availableBackendOptions,
  backendSelection,
  backendUiOptions,
  outputDeviceModel,
  inputDeviceModel,
  outputDeviceOptions,
  inputDeviceOptions,
  selectedInputDevice,
  selectedOutputDevice,
  bufferSizeModel,
  bufferSizeOptions,
  refreshDevices
} = useAudioDeviceOptions(
  preferences,
  () => props.runtime,
  (valid) => emit("validityChange", valid)
)
</script>

<template>
  <SettingsPage
    :category="t('settings.audio.devices.category')"
    :page="t('settings.audio.devices.page')"
    :title="t('settings.audio.devices.title')"
    :description="t('settings.audio.devices.description')"
  >
    <AudioBackendSection
      v-model="backendSelection"
      :options="backendUiOptions"
      :option-count="availableBackendOptions.length"
      :discovery-state="discoveryState"
    />
    <AudioDeviceSections
      v-model:output-device-id="outputDeviceModel"
      v-model:input-device-id="inputDeviceModel"
      :output-options="outputDeviceOptions"
      :input-options="inputDeviceOptions"
      :discovery-state="discoveryState"
      :discovery-error="discoveryError"
      @refresh="refreshDevices"
    />
    <AudioBufferLatencySections
      v-model:buffer-size="bufferSizeModel"
      :buffer-options="bufferSizeOptions"
      :runtime="runtime"
      :input-channel-count="selectedInputDevice?.channelCount ?? 0"
      :output-channel-count="selectedOutputDevice?.channelCount ?? 0"
    />
    <p v-if="applyError" class="apply-error" role="alert">{{ applyError }}</p>
  </SettingsPage>
</template>

<style scoped>
.apply-error {
  margin: 12px 0 0;
  color: var(--ui-signal-record);
  font-size: var(--ui-type-size-body-compact);
  line-height: var(--ui-type-leading-normal);
}
</style>
