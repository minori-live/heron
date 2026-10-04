<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { UiField, UiNumberInput, UiSelect } from "@heron/ui"
import type { DoctorSettings } from "@heron/contracts"
const props = defineProps<{ settings: DoctorSettings }>()
const emit = defineEmits<{ configure: [patch: Partial<DoctorSettings>] }>()
const { t } = useI18n()
const rates = [44100, 48000, 88200, 96000].map((value) => ({
  value: String(value),
  label: `${value / 1000} kHz`
}))
const blocks = [64, 128, 256, 512, 1024].map((value) => ({
  value: String(value),
  label: String(value)
}))
function number(key: keyof DoctorSettings, value: number | null): void {
  if (value !== null) emit("configure", { [key]: value })
}
</script>
<template>
  <section class="doctor-settings">
    <h2>{{ t("doctor.measurementSettings") }}</h2>
    <UiField v-slot="{ controlId }" :label="t('doctor.sampleRate')"
      ><UiSelect
        :id="controlId"
        :model-value="String(settings.sample_rate)"
        :options="rates"
        @update:model-value="
          emit('configure', {
            sample_rate: Number($event),
            end_hz: Math.min(props.settings.end_hz, Number($event) * 0.45)
          })
        "
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('doctor.blockSize')"
      ><UiSelect
        :id="controlId"
        :model-value="String(settings.block_size)"
        :options="blocks"
        @update:model-value="emit('configure', { block_size: Number($event) })"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('doctor.startHz')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.start_hz"
        :min="10"
        :max="settings.end_hz / 2 - 1"
        :step="10"
        suffix="Hz"
        @update:model-value="number('start_hz', $event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('doctor.endHz')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.end_hz"
        :min="settings.start_hz * 2 + 1"
        :max="settings.sample_rate * 0.45"
        :step="100"
        suffix="Hz"
        @update:model-value="number('end_hz', $event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('doctor.sweepTime')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.sweep_seconds"
        :min="1"
        :max="8"
        :step="0.5"
        suffix="s"
        @update:model-value="number('sweep_seconds', $event)"
    /></UiField>
    <UiField v-slot="{ controlId }" :label="t('doctor.tailTime')"
      ><UiNumberInput
        :id="controlId"
        :model-value="settings.tail_seconds"
        :min="0.25"
        :max="5"
        :step="0.25"
        suffix="s"
        @update:model-value="number('tail_seconds', $event)"
    /></UiField>
  </section>
</template>
<style scoped>
.doctor-settings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  width: 340px;
  max-width: 100%;
}
h2 {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--ui-type-size-control);
}
</style>
