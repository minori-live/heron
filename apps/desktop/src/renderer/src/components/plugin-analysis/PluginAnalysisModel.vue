<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiSegmentedControl, type UiAnalysisSeries } from "@heron/ui"
import type { PluginAnalysisReport } from "@heron/contracts"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
const props = defineProps<{ report: PluginAnalysisReport; comparison?: PluginAnalysisReport }>()
const { t } = useI18n()
const channel = ref("0")
const view = ref("static")
const model = computed(() => props.report.models[Number(channel.value)]!)
const channels = computed(() => [
  { value: "0", label: props.report.settings.mid_side ? "M" : "L" },
  { value: "1", label: props.report.settings.mid_side ? "S" : "R" }
])
const title = computed(() =>
  t(
    view.value === "static"
      ? "pluginAnalysis.nonlinearity"
      : view.value === "filter"
        ? "pluginAnalysis.modelFilter"
        : view.value === "orders"
          ? "pluginAnalysis.orderResponse"
          : view.value === "impulse"
            ? "pluginAnalysis.modelImpulse"
            : "pluginAnalysis.validation"
  )
)
const views = computed(() => [
  { value: "static", label: t("pluginAnalysis.nonlinearity") },
  { value: "filter", label: t("pluginAnalysis.frequency") },
  { value: "orders", label: t("pluginAnalysis.orderResponse") },
  { value: "impulse", label: t("pluginAnalysis.impulse") },
  { value: "validation", label: t("pluginAnalysis.validation") }
])
const orderColors = [
  "var(--ui-signal-mixer-input)",
  "var(--ui-color-action)",
  "var(--ui-signal-audio)",
  "var(--ui-signal-midi)",
  "var(--ui-signal-loop)",
  "var(--ui-signal-record)",
  "var(--ui-signal-meter-safe)"
]
const makeSeries = (report: PluginAnalysisReport): UiAnalysisSeries[] => {
  const m = report.models[Number(channel.value)]!
  if (view.value === "static") {
    const x = Array.from({ length: 257 }, (_, i) => (i / 128 - 1) * m.input_scale)
    return [
      {
        label: "f(x)",
        x,
        y: x.map((value) =>
          m.filters.reduce(
            (sum, filter, i) =>
              sum + filter.reduce((a, b) => a + b, 0) * (value / m.input_scale) ** (i + 1),
            m.dc_offset
          )
        )
      }
    ]
  }
  if (view.value === "impulse")
    return [
      {
        label: "H",
        x: m.filters[0]!.map((_, i) => (i / report.settings.sample_rate) * 1000),
        y: m.filters[0]!
      }
    ]
  if (view.value === "validation") {
    const x = m.predicted.map(
      (_, i) => ((i * m.validation_stride) / report.settings.sample_rate) * 1000
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
      report.settings.start_hz * (report.settings.end_hz / report.settings.start_hz) ** (i / 191)
  )
  const response = (filter: number[]) =>
    x.map((hz) => {
      let re = 0,
        im = 0
      filter.forEach((value, i) => {
        const phase = (2 * Math.PI * hz * i) / report.settings.sample_rate
        re += value * Math.cos(phase)
        im -= value * Math.sin(phase)
      })
      return 20 * Math.log10(Math.max(1e-12, Math.hypot(re, im)))
    })
  if (view.value === "orders")
    return m.filters.map((filter, index) => ({
      label: t("pluginAnalysis.orderLabel", { order: index + 1 }),
      x,
      y: response(filter),
      color: orderColors[index % orderColors.length]
    }))
  return [{ label: "H1", x, y: response(m.filters[0]!) }]
}
const series = computed(() => [
  ...makeSeries(props.report),
  ...(props.comparison
    ? makeSeries(props.comparison).map((s) => ({
        ...s,
        label: `${t("pluginAnalysis.chain2")} · ${s.label}`,
        dashed: true
      }))
    : [])
])
</script>
<template>
  <section class="model-panel">
    <PluginAnalysisPlot
      :title="title"
      :x-label="
        view === 'static'
          ? t('pluginAnalysis.input')
          : view === 'filter' || view === 'orders'
            ? 'Hz'
            : 'ms'
      "
      :y-label="
        view === 'filter' || view === 'orders'
          ? t('pluginAnalysis.units.db')
          : view === 'static'
            ? t('pluginAnalysis.output')
            : t('pluginAnalysis.amplitude')
      "
      :logarithmic="view === 'filter' || view === 'orders'"
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
