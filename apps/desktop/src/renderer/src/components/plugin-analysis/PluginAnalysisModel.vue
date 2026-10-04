<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiSegmentedControl, type UiAnalysisSeries } from "@heron/ui"
import type { PluginAnalysisReport } from "@heron/contracts"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
const props = defineProps<{ report: PluginAnalysisReport }>()
const { t } = useI18n()
const channel = ref("0")
const view = ref("static")
const model = computed(() => props.report.models[Number(channel.value)]!)
const channels = [
  { value: "0", label: "L" },
  { value: "1", label: "R" }
]
const title = computed(() =>
  t(
    view.value === "static"
      ? "pluginAnalysis.nonlinearity"
      : view.value === "filter"
        ? "pluginAnalysis.modelFilter"
        : view.value === "impulse"
          ? "pluginAnalysis.modelImpulse"
          : "pluginAnalysis.validation"
  )
)
const views = computed(() => [
  { value: "static", label: t("pluginAnalysis.nonlinearity") },
  { value: "filter", label: t("pluginAnalysis.frequency") },
  { value: "impulse", label: t("pluginAnalysis.impulse") },
  { value: "validation", label: t("pluginAnalysis.validation") }
])
const series = computed<UiAnalysisSeries[]>(() => {
  const m = model.value
  if (view.value === "static") {
    const x = Array.from({ length: 257 }, (_, i) => (i / 128 - 1) * m.input_scale)
    return [
      {
        label: "f(x)",
        x,
        y: x.map((value) =>
          m.coefficients.reduce(
            (sum, coefficient, i) => sum + coefficient * (value / m.input_scale) ** (i + 1),
            0
          )
        )
      }
    ]
  }
  if (view.value === "impulse")
    return [
      {
        label: "H",
        x: m.filter.map((_, i) => (i / props.report.settings.sample_rate) * 1000),
        y: m.filter
      }
    ]
  if (view.value === "validation") {
    const x = m.predicted.map(
      (_, i) => ((i * m.validation_stride) / props.report.settings.sample_rate) * 1000
    )
    return [
      { label: t("pluginAnalysis.observed"), x, y: m.observed },
      {
        label: t("pluginAnalysis.predicted"),
        x,
        y: m.predicted,
        color: "var(--ui-color-action)",
        dashed: true
      }
    ]
  }
  const x = Array.from(
    { length: 192 },
    (_, i) =>
      props.report.settings.start_hz *
      (props.report.settings.end_hz / props.report.settings.start_hz) ** (i / 191)
  )
  return [
    {
      label: "H",
      x,
      y: x.map((hz) => {
        let re = 0,
          im = 0
        m.filter.forEach((value, i) => {
          const phase = (2 * Math.PI * hz * i) / props.report.settings.sample_rate
          re += value * Math.cos(phase)
          im -= value * Math.sin(phase)
        })
        return 20 * Math.log10(Math.max(1e-12, Math.hypot(re, im)))
      })
    }
  ]
})
</script>
<template>
  <section class="model-panel">
    <PluginAnalysisPlot
      :title="title"
      :x-label="view === 'static' ? t('pluginAnalysis.input') : view === 'filter' ? 'Hz' : 'ms'"
      :y-label="
        view === 'filter'
          ? t('pluginAnalysis.units.db')
          : view === 'static'
            ? t('pluginAnalysis.output')
            : t('pluginAnalysis.amplitude')
      "
      :logarithmic="view === 'filter'"
      :series="series"
    />
    <footer class="toolbar">
      <UiSegmentedControl
        v-model="view"
        :options="views"
        :label="t('pluginAnalysis.modelView')"
        size="compact"
        required
      /><UiSegmentedControl
        v-model="channel"
        :options="channels"
        :label="t('pluginAnalysis.channel')"
        size="compact"
        required
      /><span class="validation-error" :class="{ unsuitable: !model.suitable }">{{
        t("pluginAnalysis.validationError", { error: model.validation_error_percent.toFixed(2) })
      }}</span>
    </footer>
  </section>
</template>
<style scoped>
.model-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 10px 16px;
  border-top: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-sunken);
  font-size: var(--ui-type-size-caption);
}
.validation-error {
  margin-left: auto;
  font-family: var(--ui-type-family-data);
}
.unsuitable {
  color: var(--ui-color-warning);
}
</style>
