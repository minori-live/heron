<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { UiButton, UiCheckbox, UiField, UiNumberInput, UiSelect, UiStatusNotice } from "@heron/ui"
import { PROJECT_SAMPLE_RATES } from "@heron/contracts"
import type { LiveDocumentConfiguration } from "@heron/contracts"
import AudioBackendSection from "../system-settings/AudioBackendSection.vue"
import AudioDeviceSections from "../system-settings/AudioDeviceSections.vue"
import SettingsSection from "../settings/SettingsSection.vue"
import { useLiveDeviceSettings } from "./useLiveDeviceSettings"

const props = defineProps<{
  configuration: LiveDocumentConfiguration
  pending: boolean
  error?: string
}>()
const emit = defineEmits<{ configure: [configuration: LiveDocumentConfiguration] }>()
const { t } = useI18n()
const {
  draft,
  backend,
  backendOptions,
  inputOptions,
  outputOptions,
  midiPorts,
  discoveryState,
  discoveryError,
  midiError,
  dirty,
  valid,
  selectBackend,
  updateAudio,
  updateSampleRate,
  updateBufferSize,
  toggleMidiPort,
  refresh
} = useLiveDeviceSettings(() => props.configuration)

function configure(): void {
  if (!props.pending && dirty.value && valid.value) {
    emit("configure", structuredClone(draft.value))
  }
}
</script>

<template>
  <div class="live-device-settings min-w-0">
    <AudioBackendSection
      layout="stacked"
      :model-value="backend"
      :options="backendOptions"
      :option-count="backendOptions.length"
      :discovery-state="discoveryState"
      :disabled="pending"
      @update:model-value="selectBackend"
    />
    <AudioDeviceSections
      layout="stacked"
      :input-device-id="draft.audio?.inputDeviceId ?? ''"
      :output-device-id="draft.audio?.outputDeviceId ?? ''"
      :input-options="inputOptions"
      :output-options="outputOptions"
      :discovery-state="discoveryState"
      discovery-error=""
      :disabled="pending"
      :input-description="t('live.inputDeviceDescription')"
      :output-description="t('live.outputDeviceDescription')"
      @update:input-device-id="updateAudio({ inputDeviceId: $event })"
      @update:output-device-id="updateAudio({ outputDeviceId: $event })"
      @refresh="refresh"
    />
    <SettingsSection
      layout="stacked"
      :title="t('settings.audio.buffer.title')"
      :description="t('settings.audio.buffer.description')"
    >
      <div class="grid gap-ui-4">
        <UiField v-slot="{ controlId }" :label="t('studio.inspector.sampleRate')">
          <UiSelect
            :id="controlId"
            :aria-label="t('studio.inspector.sampleRate')"
            :model-value="String(draft.sampleRate)"
            :disabled="pending"
            @update:model-value="updateSampleRate(Number($event))"
          >
            <option v-for="rate in PROJECT_SAMPLE_RATES" :key="rate" :value="String(rate)">
              {{ rate }} Hz
            </option>
          </UiSelect>
        </UiField>
        <UiField v-slot="{ controlId }" :label="t('live.buffer')">
          <UiNumberInput
            :id="controlId"
            :aria-label="t('live.buffer')"
            :model-value="draft.audio?.bufferSize ?? 256"
            :min="16"
            :max="16384"
            :disabled="pending || !draft.audio"
            @update:model-value="updateBufferSize"
          />
        </UiField>
      </div>
    </SettingsSection>
    <SettingsSection
      layout="stacked"
      :title="t('live.midiDevices')"
      :description="t('live.deviceMidiDescription')"
    >
      <div class="grid gap-ui-3">
        <UiCheckbox
          v-for="port in midiPorts"
          :key="port.id"
          :label="port.connected ? port.name : `${port.name} (${t('live.missing')})`"
          :description="port.id"
          :model-value="draft.enabledMidiDeviceIds.includes(port.id)"
          :disabled="pending"
          @update:model-value="toggleMidiPort(port.id, $event)"
        />
        <p v-if="midiPorts.length === 0" class="m-0 text-ui-sm text-ui-text-muted">
          {{ t("live.noMidiDevices") }}
        </p>
      </div>
    </SettingsSection>
    <div class="grid gap-ui-3 pt-ui-4">
      <UiStatusNotice v-if="error || discoveryError || midiError" tone="danger" live="assertive">
        {{ error || discoveryError || midiError }}
      </UiStatusNotice>
      <div class="flex justify-end">
        <UiButton
          :disabled="pending || !dirty || !valid"
          :loading="pending"
          variant="primary"
          @click="configure"
        >
          {{ t("live.saveRig") }}
        </UiButton>
      </div>
    </div>
  </div>
</template>
