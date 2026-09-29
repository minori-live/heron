<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { RefreshCw } from "@lucide/vue"
import { UiButton, UiSelect, type UiSelectOption } from "@heron/ui"
import SettingsSection from "../settings/SettingsSection.vue"

defineProps<{
  outputDeviceId: string
  inputDeviceId: string
  outputOptions: readonly UiSelectOption[]
  inputOptions: readonly UiSelectOption[]
  discoveryState: string
  discoveryError: string
  disabled?: boolean
  inputDescription?: string
  outputDescription?: string
  layout?: "columns" | "stacked"
}>()
const emit = defineEmits<{
  "update:outputDeviceId": [value: string]
  "update:inputDeviceId": [value: string]
  refresh: []
}>()

const { t } = useI18n()
</script>

<template>
  <SettingsSection
    :title="t('settings.audio.deviceSections.output.title')"
    :description="outputDescription ?? t('settings.audio.deviceSections.output.description')"
    :layout="layout"
  >
    <UiButton
      class="refresh-button"
      type="button"
      :disabled="disabled || discoveryState === 'loading'"
      @click="emit('refresh')"
    >
      <RefreshCw :size="12" :class="{ spinning: discoveryState === 'loading' }" />
      {{
        discoveryState === "loading"
          ? t("settings.audio.deviceSections.refresh.scanning")
          : t("settings.audio.deviceSections.refresh.refresh")
      }}
    </UiButton>
    <p v-if="discoveryError" class="discovery-error">{{ discoveryError }}</p>
    <label class="device-field">
      <span>{{ t("common.device") }}</span>
      <UiSelect
        :model-value="outputDeviceId"
        :options="outputOptions"
        :placeholder="
          outputOptions.length
            ? t('settings.audio.deviceSections.output.placeholder')
            : t('settings.audio.deviceSections.output.emptyPlaceholder')
        "
        size="sm"
        :aria-label="t('settings.audio.deviceSections.output.ariaLabel')"
        :disabled="disabled || discoveryState !== 'ready' || outputOptions.length === 0"
        @update:model-value="emit('update:outputDeviceId', $event)"
      />
    </label>
  </SettingsSection>
  <SettingsSection
    :title="t('settings.audio.deviceSections.input.title')"
    :description="inputDescription ?? t('settings.audio.deviceSections.input.description')"
    :layout="layout"
  >
    <label class="device-field">
      <span>{{ t("common.device") }}</span>
      <UiSelect
        :model-value="inputDeviceId"
        :options="inputOptions"
        :placeholder="
          inputOptions.length
            ? t('settings.audio.deviceSections.input.placeholder')
            : t('settings.audio.deviceSections.input.emptyPlaceholder')
        "
        size="sm"
        :aria-label="t('settings.audio.deviceSections.input.ariaLabel')"
        :disabled="disabled || discoveryState !== 'ready' || inputOptions.length === 0"
        @update:model-value="emit('update:inputDeviceId', $event)"
      />
    </label>
  </SettingsSection>
</template>

<style scoped>
.device-field {
  display: grid;
  gap: 7px;
  margin-top: 12px;
  color: var(--ui-color-text-subtle);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
  text-transform: uppercase;
}
.refresh-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  color: var(--ui-signal-audio);
  background: transparent;
  font-size: var(--ui-type-size-control);
}
.refresh-button:disabled {
  color: var(--ui-color-text-subtle);
}
.spinning {
  animation: icon-spin 800ms linear infinite;
}
.discovery-error {
  margin: 8px 0 0;
  color: var(--ui-signal-record);
  font-size: var(--ui-type-size-control);
  overflow-wrap: anywhere;
}
@keyframes icon-spin {
  to {
    transform: rotate(1turn);
  }
}
</style>
