<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { UiField, UiNumberInput } from "@heron/ui"
import type { PluginAnalysisSettings } from "@heron/contracts"
const props = defineProps<{ settings: PluginAnalysisSettings }>()
const emit = defineEmits<{ configure: [patch: Partial<PluginAnalysisSettings>] }>()
const { t } = useI18n()
const rampFields = [
  { key: "ramp_start_dbfs", label: "rampStart", min: -100, max: 12, step: 1, suffix: "dBFS" },
  { key: "ramp_end_dbfs", label: "rampEnd", min: -100, max: 12, step: 1, suffix: "dBFS" },
  { key: "ramp_step_db", label: "rampStep", min: 0.5, max: 12, step: 0.5, suffix: "dB" },
  { key: "ramp_seconds", label: "rampDuration", min: 0.4, max: 1.5, step: 0.1, suffix: "s" }
] as const
function segment(
  key: "dynamics_levels_dbfs" | "dynamics_seconds",
  index: number,
  value: number | null
): void {
  if (value === null) return
  const values = [...props.settings[key]] as [number, number, number]
  values[index] = value
  emit("configure", { [key]: values })
}
</script>
<template>
  <section class="dynamics-settings">
    <h3>{{ t("pluginAnalysis.tabs.dynamics") }}</h3>
    <UiField
      v-for="field in rampFields"
      :key="field.key"
      v-slot="{ controlId }"
      :label="t(`pluginAnalysis.${field.label}`)"
    >
      <UiNumberInput
        :id="controlId"
        :model-value="settings[field.key]"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :suffix="field.suffix"
        @update:model-value="$event !== null && emit('configure', { [field.key]: $event })"
      />
    </UiField>
    <template v-for="index in [0, 1, 2]" :key="index">
      <UiField
        v-slot="{ controlId }"
        :label="t('pluginAnalysis.segmentLevel', { segment: index + 1 })"
        ><UiNumberInput
          :id="controlId"
          :model-value="settings.dynamics_levels_dbfs[index]"
          :min="-100"
          :max="12"
          :step="1"
          suffix="dBFS"
          @update:model-value="segment('dynamics_levels_dbfs', index, $event)"
      /></UiField>
      <UiField
        v-slot="{ controlId }"
        :label="t('pluginAnalysis.segmentDuration', { segment: index + 1 })"
        ><UiNumberInput
          :id="controlId"
          :model-value="settings.dynamics_seconds[index]"
          :min="0.01"
          :max="5"
          :step="0.01"
          suffix="s"
          @update:model-value="segment('dynamics_seconds', index, $event)"
      /></UiField>
    </template>
  </section>
</template>
<style scoped>
.dynamics-settings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  grid-column: 1/-1;
}
h3 {
  grid-column: 1/-1;
  margin: 0;
  font-size: var(--ui-type-size-control);
}
</style>
