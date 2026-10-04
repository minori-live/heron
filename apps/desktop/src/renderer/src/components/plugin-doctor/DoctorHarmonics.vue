<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiNumberInput, UiSegmentedControl, UiSelect, type UiAnalysisHeatmap } from "@heron/ui"
import type { DoctorReport } from "@heron/contracts"
import DoctorPlot from "./DoctorPlot.vue"
const props = defineProps<{ report: DoctorReport }>()
const { t } = useI18n()
const channel = ref("0")
const view = ref("2d")
const sweep = ref("log")
const frequencyScale = ref("log")
const magnitudeScale = ref("log")
const colorMin = ref(-120)
const colorMax = ref(12)
const channels = [
  { value: "0", label: "L" },
  { value: "1", label: "R" }
]
const views = computed(() => [
  { value: "2d", label: t("doctor.spectrum2d") },
  { value: "1d", label: t("doctor.orders1d") },
  { value: "thd", label: t("doctor.thd") }
])
const scales = computed(() => [
  { value: "linear", label: t("doctor.scaleLinear") },
  { value: "log", label: t("doctor.scaleLog") }
])
const magnitudeScales = computed(() => [
  { value: "linear", label: t("doctor.magnitudeLinear") },
  { value: "log", label: t("doctor.magnitudeLog") }
])
const harmonic = computed(() => props.report.harmonics[Number(channel.value)]!)
const spectrum = computed(() =>
  props.report.spectrograms.find(
    (p) => p.channel === Number(channel.value) && p.logarithmic_sweep === (sweep.value === "log")
  )
)
const heatmap = computed<UiAnalysisHeatmap | undefined>(() =>
  spectrum.value
    ? {
        columns: spectrum.value.columns,
        rows: spectrum.value.rows,
        values: spectrum.value.magnitude_dbfs
      }
    : undefined
)
const colors = [
  "var(--ui-signal-mixer-input)",
  "var(--ui-color-action)",
  "var(--ui-signal-audio)",
  "var(--ui-signal-midi)",
  "var(--ui-signal-loop)",
  "var(--ui-signal-record)",
  "var(--ui-signal-meter-safe)"
]
const series = computed(() =>
  view.value === "2d"
    ? []
    : view.value === "thd"
      ? [
          {
            label: channel.value === "0" ? "L" : "R",
            x: harmonic.value.frequency_hz,
            y: harmonic.value.thd_percent
          }
        ]
      : harmonic.value.orders_db.map((values, index) => ({
          label: `H${index + 2}`,
          x: harmonic.value.frequency_hz,
          y:
            magnitudeScale.value === "log"
              ? values
              : values.map((db) => (db === null ? null : 100 * 10 ** (db / 20))),
          color: colors[index]
        }))
)
const title = computed(() =>
  t(
    view.value === "2d"
      ? "doctor.spectrum2d"
      : view.value === "thd"
        ? "doctor.thd"
        : "doctor.harmonicResponse"
  )
)
</script>
<template>
  <section class="harmonics-panel">
    <DoctorPlot
      :title="title"
      :x-label="view === '2d' ? 's' : 'Hz'"
      :y-label="
        view === '2d'
          ? 'Hz'
          : view === 'thd' || magnitudeScale === 'linear'
            ? '%'
            : t('doctor.units.dbc')
      "
      :series="series"
      :logarithmic="view !== '2d' && frequencyScale === 'log'"
      :heatmap="view === '2d' ? heatmap : undefined"
      :x-domain="
        view === '2d' ? [0, spectrum?.duration_seconds ?? report.settings.sweep_seconds] : undefined
      "
      :y-domain="
        view === '2d'
          ? [0, spectrum?.maximum_frequency_hz ?? report.settings.sample_rate / 2]
          : undefined
      "
      :color-domain="[colorMin, colorMax]"
    />
    <footer class="toolbar">
      <UiSegmentedControl
        v-model="view"
        :options="views"
        :label="t('doctor.harmonicView')"
        size="compact"
        required
      /><UiSegmentedControl
        v-model="channel"
        :options="channels"
        :label="t('doctor.channel')"
        size="compact"
        required
      />
      <template v-if="view === '2d'">
        <div class="sweep-controls">
          <span>{{ t("doctor.sweepScale") }}</span>
          <UiSegmentedControl
            v-model="sweep"
            :options="scales"
            :label="t('doctor.sweepScale')"
            size="compact"
            required
          />
        </div>
        <div class="energy-controls">
          <span>{{ t("doctor.colorRange") }}</span>
          <UiNumberInput
            :model-value="colorMin"
            :min="-160"
            :max="colorMax - 1"
            :step="5"
            suffix="dBFS"
            :aria-label="t('doctor.colorMinimum')"
            @update:model-value="$event !== null && (colorMin = $event)"
          /><UiNumberInput
            :model-value="colorMax"
            :min="colorMin + 1"
            :max="60"
            :step="5"
            suffix="dBFS"
            :aria-label="t('doctor.colorMaximum')"
            @update:model-value="$event !== null && (colorMax = $event)"
          />
        </div>
      </template>
      <template v-else
        ><UiSegmentedControl
          v-model="frequencyScale"
          :options="scales"
          :label="t('doctor.frequencyScale')"
          size="compact"
          required /><UiSelect
          v-if="view === '1d'"
          v-model="magnitudeScale"
          :options="magnitudeScales"
          size="sm"
          :aria-label="t('doctor.magnitudeScale')"
      /></template>
    </footer>
  </section>
</template>
<style scoped>
.harmonics-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-sunken);
  font-size: var(--ui-type-size-caption);
}
.energy-controls > :deep(.ui-number-input) {
  width: 104px;
}
.toolbar > :deep(.ui-select-shell) {
  width: 210px;
}
.sweep-controls,
.energy-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.energy-controls {
  margin-left: auto;
}
</style>
