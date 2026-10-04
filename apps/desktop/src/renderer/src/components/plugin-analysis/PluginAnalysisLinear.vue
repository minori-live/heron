<script setup lang="ts">
import { computed, ref, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import {
  UiButton,
  UiCheckbox,
  UiSegmentedControl,
  UiSelect,
  type UiAnalysisSeries
} from "@heron/ui"
import type { PluginAnalysisReport } from "@heron/contracts"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
const props = defineProps<{ report: PluginAnalysisReport }>()
const { t } = useI18n()
const view = ref("magnitude")
const path = ref("direct")
const compensate = ref(false)
const stored = shallowRef<UiAnalysisSeries[]>([])
const modes = computed(() => [
  { value: "magnitude", label: t("pluginAnalysis.magnitude") },
  { value: "phase", label: t("pluginAnalysis.phase") },
  { value: "impulse", label: t("pluginAnalysis.impulse") }
])
const paths = computed(() => [
  { value: "direct", label: t("pluginAnalysis.bothChannels") },
  ...props.report.responses.map((p, i) => ({
    value: String(i),
    label: `${p.input ? "R" : "L"} → ${p.output ? "R" : "L"}`
  }))
])
const responses = computed(() =>
  props.report.responses.filter((p, i) =>
    path.value === "direct" ? p.input === p.output : i === Number(path.value)
  )
)
const series = computed<UiAnalysisSeries[]>(() =>
  responses.value.map((p, index) => ({
    label: `${p.input ? "R" : "L"} → ${p.output ? "R" : "L"}`,
    color: index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)",
    x:
      view.value === "impulse"
        ? p.impulse.map(
            (_, i) =>
              ((p.impulse_start_samples +
                i * p.impulse_stride -
                (compensate.value ? (p.delay_samples ?? 0) : 0)) /
                props.report.settings.sample_rate) *
              1000
          )
        : p.frequency_hz,
    y:
      view.value === "magnitude"
        ? p.magnitude_db
        : view.value === "impulse"
          ? p.impulse
          : p.phase_degrees.map((value, i) =>
              value === null
                ? null
                : value +
                  (compensate.value
                    ? (360 * p.frequency_hz[i]! * (p.delay_samples ?? 0)) /
                      props.report.settings.sample_rate
                    : 0)
            )
  }))
)
const displayed = computed(() => [...stored.value, ...series.value])
const responseDomain = computed<readonly [number, number] | undefined>(() => {
  if (view.value === "impulse") return undefined
  const values = displayed.value.flatMap((s) =>
    s.y.filter((v): v is number => v !== null && Number.isFinite(v))
  )
  // Keep at least one degree per phase grid interval; numerical noise is not useful zoom.
  const extent = view.value === "phase" ? 3 : 6
  return [
    Math.min(-extent, Math.floor(Math.min(...values, 0) / extent) * extent),
    Math.max(extent, Math.ceil(Math.max(...values, 0) / extent) * extent)
  ]
})
const title = computed(() =>
  t(
    view.value === "magnitude"
      ? "pluginAnalysis.frequency"
      : view.value === "phase"
        ? "pluginAnalysis.phase"
        : "pluginAnalysis.impulse"
  )
)
function store(): void {
  stored.value = series.value.map((s) => ({
    ...s,
    x: [...s.x],
    y: [...s.y],
    label: `${s.label} · ${t("pluginAnalysis.stored")}`,
    dashed: true,
    color: "var(--ui-color-text-faint)"
  }))
}
function changeView(): void {
  stored.value = []
}
</script>
<template>
  <section class="linear-panel">
    <PluginAnalysisPlot
      :title="title"
      :x-label="view === 'impulse' ? 'ms' : 'Hz'"
      :y-label="
        view === 'magnitude'
          ? t('pluginAnalysis.units.db')
          : view === 'phase'
            ? '°'
            : t('pluginAnalysis.amplitude')
      "
      :logarithmic="view !== 'impulse'"
      :series="displayed"
      :y-domain="responseDomain"
    />
    <footer class="toolbar">
      <UiSegmentedControl
        v-model="view"
        :options="modes"
        :label="t('pluginAnalysis.responseView')"
        size="compact"
        required
        @update:model-value="changeView"
      /><UiSelect
        v-model="path"
        :options="paths"
        size="sm"
        :aria-label="t('pluginAnalysis.signalPath')"
      /><UiCheckbox v-model="compensate" :label="t('pluginAnalysis.compensate')" /><span
        class="spacer"
      /><UiButton size="sm" variant="secondary" @click="store">{{
        t("pluginAnalysis.store")
      }}</UiButton
      ><UiButton size="sm" variant="ghost" :disabled="!stored.length" @click="stored = []">{{
        t("pluginAnalysis.clear")
      }}</UiButton>
    </footer>
  </section>
</template>
<style scoped>
.linear-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-sunken);
}
.toolbar > :deep(.ui-select-shell) {
  width: 140px;
}
.spacer {
  flex: 1;
}
</style>
