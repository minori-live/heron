<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { UiField, UiNumberInput, UiSelect } from "@heron/ui"
import PluginAnalysisDynamicsSettings from "./PluginAnalysisDynamicsSettings.vue"
import type { PluginAnalysisSettings } from "@heron/contracts"
const props = defineProps<{ settings: PluginAnalysisSettings }>()
const emit = defineEmits<{ configure: [patch: Partial<PluginAnalysisSettings>] }>()
const { t } = useI18n()
const rates = [44100, 48000, 88200, 96000].map((value) => ({
  value: String(value),
  label: `${value / 1000} kHz`
}))
const blocks = [64, 128, 256, 512, 1024].map((value) => ({
  value: String(value),
  label: String(value)
}))
function number(key: keyof PluginAnalysisSettings, value: number | null): void {
  if (value !== null) emit("configure", { [key]: value })
}
function sampleRate(value: string): void {
  const rate = Number(value)
  const limit = rate * 0.45
  const end = Math.min(props.settings.end_hz, limit)
  emit("configure", {
    sample_rate: rate,
    start_hz: props.settings.start_hz * 2 >= end ? end / 2 - 1 : props.settings.start_hz,
    end_hz: end,
    tone_hz: Math.min(props.settings.tone_hz, limit)
  })
}
</script>
<template>
  <div class="plugin-analysis-settings">
    <section>
      <h3>{{ t("pluginAnalysis.settingsSections.engine") }}</h3>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.sampleRate')"
        ><UiSelect
          :id="controlId"
          size="sm"
          :model-value="String(settings.sample_rate)"
          :options="rates"
          @update:model-value="sampleRate($event)"
      /></UiField>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.blockSize')"
        ><UiSelect
          :id="controlId"
          size="sm"
          :model-value="String(settings.block_size)"
          :options="blocks"
          @update:model-value="emit('configure', { block_size: Number($event) })"
      /></UiField>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.speed')"
        ><UiSelect
          :id="controlId"
          size="sm"
          :model-value="settings.processing_speed"
          :options="
            ['realtime', 'x2', 'x4', 'ultra'].map((value) => ({
              value,
              label: t(`pluginAnalysis.speed_${value}`)
            }))
          "
          @update:model-value="emit('configure', { processing_speed: $event })"
      /></UiField>
    </section>
    <section>
      <h3>{{ t("pluginAnalysis.settingsSections.sweep") }}</h3>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.excitation')"
        ><UiSelect
          :id="controlId"
          size="sm"
          :model-value="settings.linear_excitation"
          :options="
            ['sweep', 'delta', 'random'].map((value) => ({
              value,
              label: t(`pluginAnalysis.excitation_${value}`)
            }))
          "
          @update:model-value="emit('configure', { linear_excitation: $event })"
      /></UiField>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.quality')"
        ><UiSelect
          :id="controlId"
          size="sm"
          :model-value="String(settings.fft_size)"
          :options="
            [16384, 32768, 65536].map((value) => ({ value: String(value), label: String(value) }))
          "
          @update:model-value="emit('configure', { fft_size: Number($event) })"
      /></UiField>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.startHz')"
        ><UiNumberInput
          :id="controlId"
          size="sm"
          :model-value="settings.start_hz"
          :min="10"
          :max="settings.end_hz / 2 - 1"
          :step="10"
          suffix="Hz"
          @update:model-value="number('start_hz', $event)"
      /></UiField>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.endHz')"
        ><UiNumberInput
          :id="controlId"
          size="sm"
          :model-value="settings.end_hz"
          :min="settings.start_hz * 2 + 1"
          :max="settings.sample_rate * 0.45"
          :step="100"
          suffix="Hz"
          @update:model-value="number('end_hz', $event)"
      /></UiField>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.sweepTime')"
        ><UiNumberInput
          :id="controlId"
          size="sm"
          :model-value="settings.sweep_seconds"
          :min="1"
          :max="8"
          :step="0.5"
          suffix="s"
          @update:model-value="number('sweep_seconds', $event)"
      /></UiField>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.tailTime')"
        ><UiNumberInput
          :id="controlId"
          size="sm"
          :model-value="settings.tail_seconds"
          :min="0.25"
          :max="5"
          :step="0.25"
          suffix="s"
          @update:model-value="number('tail_seconds', $event)"
      /></UiField>
    </section>
    <section>
      <h3>{{ t("pluginAnalysis.settingsSections.tone") }}</h3>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.toneFrequency')"
        ><UiNumberInput
          :id="controlId"
          size="sm"
          :model-value="settings.tone_hz"
          :min="20"
          :max="settings.sample_rate * 0.45"
          :step="10"
          suffix="Hz"
          @update:model-value="number('tone_hz', $event)"
      /></UiField>
    </section>
    <section>
      <h3>{{ t("pluginAnalysis.settingsSections.model") }}</h3>
      <UiField v-slot="{ controlId }" layout="inline" :label="t('pluginAnalysis.modelOrder')"
        ><UiNumberInput
          :id="controlId"
          size="sm"
          :model-value="settings.model_order"
          :min="3"
          :max="7"
          :step="1"
          @update:model-value="number('model_order', $event)"
      /></UiField>
    </section>
    <PluginAnalysisDynamicsSettings :settings="settings" @configure="emit('configure', $event)" />
  </div>
</template>
<style scoped>
.plugin-analysis-settings {
  display: flex;
  flex-direction: column;
}
.plugin-analysis-settings > :deep(section) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 16px;
  border-bottom: 1px solid var(--ui-color-border);
}
.plugin-analysis-settings > :deep(section:last-child) {
  border-bottom: 0;
}
.plugin-analysis-settings :deep(h3) {
  margin: 0 0 2px;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-label);
  font-weight: var(--ui-type-weight-semibold);
  letter-spacing: var(--ui-type-tracking-wide);
  text-transform: uppercase;
}
.plugin-analysis-settings :deep(.ui-field) {
  row-gap: 0;
}
.plugin-analysis-settings :deep(.ui-field__control) {
  width: 120px;
}
.plugin-analysis-settings :deep(.ui-field__control > *) {
  width: 100%;
}
</style>
