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
  <section class="plugin-analysis-settings">
    <h2>{{ t("pluginAnalysis.measurementSettings") }}</h2>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.excitation')"
      ><UiSelect
        :id="controlId"
        :model-value="settings.linear_excitation"
        :options="
          ['sweep', 'delta', 'random'].map((value) => ({
            value,
            label: t(`pluginAnalysis.excitation_${value}`)
          }))
        "
        @update:model-value="emit('configure', { linear_excitation: $event })"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.quality')"
      ><UiSelect
        :id="controlId"
        :model-value="String(settings.fft_size)"
        :options="
          [16384, 32768, 65536].map((value) => ({ value: String(value), label: String(value) }))
        "
        @update:model-value="emit('configure', { fft_size: Number($event) })"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.speed')"
      ><UiSelect
        :id="controlId"
        :model-value="settings.processing_speed"
        :options="
          ['realtime', 'x2', 'x4', 'ultra'].map((value) => ({
            value,
            label: t(`pluginAnalysis.speed_${value}`)
          }))
        "
        @update:model-value="emit('configure', { processing_speed: $event })"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.sampleRate')"
      ><UiSelect
        :id="controlId"
        :model-value="String(settings.sample_rate)"
        :options="rates"
        @update:model-value="sampleRate($event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.blockSize')"
      ><UiSelect
        :id="controlId"
        :model-value="String(settings.block_size)"
        :options="blocks"
        @update:model-value="emit('configure', { block_size: Number($event) })"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.startHz')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.start_hz"
        :min="10"
        :max="settings.end_hz / 2 - 1"
        :step="10"
        suffix="Hz"
        @update:model-value="number('start_hz', $event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.endHz')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.end_hz"
        :min="settings.start_hz * 2 + 1"
        :max="settings.sample_rate * 0.45"
        :step="100"
        suffix="Hz"
        @update:model-value="number('end_hz', $event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.sweepTime')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.sweep_seconds"
        :min="1"
        :max="8"
        :step="0.5"
        suffix="s"
        @update:model-value="number('sweep_seconds', $event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.tailTime')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.tail_seconds"
        :min="0.25"
        :max="5"
        :step="0.25"
        suffix="s"
        @update:model-value="number('tail_seconds', $event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.toneFrequency')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.tone_hz"
        :min="20"
        :max="settings.sample_rate * 0.45"
        :step="10"
        suffix="Hz"
        @update:model-value="number('tone_hz', $event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('pluginAnalysis.modelOrder')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.model_order"
        :min="3"
        :max="7"
        :step="1"
        @update:model-value="number('model_order', $event)"
    /></UiField>
    <PluginAnalysisDynamicsSettings :settings="settings" @configure="emit('configure', $event)" />
  </section>
</template>
<style scoped>
.plugin-analysis-settings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  width: 420px;
  max-width: 100%;
}
h2 {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--ui-type-size-control);
}
</style>
