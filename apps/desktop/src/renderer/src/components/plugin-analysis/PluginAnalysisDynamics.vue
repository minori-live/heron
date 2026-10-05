<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiSegmentedControl, type UiAnalysisSeries } from "@heron/ui"
import type { PluginAnalysisReport } from "@heron/contracts"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
const props = defineProps<{ report: PluginAnalysisReport; comparison?: PluginAnalysisReport }>()
const { t } = useI18n()
const channel = ref("0")
const view = ref("ramp")
const channels = computed(() => [
  { value: "0", label: props.report.settings.mid_side ? "M" : "L" },
  { value: "1", label: props.report.settings.mid_side ? "S" : "R" }
])
const views = computed(() => [
  { value: "ramp", label: t("pluginAnalysis.ramp") },
  { value: "attack", label: t("pluginAnalysis.attackRelease") }
])
const decibels = (value: number): number => 20 * Math.log10(Math.max(1e-12, value))
const makeSeries = (report: PluginAnalysisReport): UiAnalysisSeries[] => {
  const data = report.dynamics[Number(channel.value)]
  if (!data) return []
  if (view.value === "ramp")
    return [
      {
        label: t("pluginAnalysis.outputLevel"),
        x: data.ramp.map((point) => point.input_dbfs),
        y: data.ramp.map((point) => point.output_dbfs)
      },
      {
        label: "1:1",
        x: [-100, 0],
        y: [-100, 0],
        color: "var(--ui-color-text-faint)",
        dashed: true
      }
    ]
  const x = data.time_seconds.map((value) => value * 1000)
  return [
    {
      label: t("pluginAnalysis.inputLevel"),
      x,
      y: data.input_envelope.map(decibels),
      color: "var(--ui-color-text-faint)",
      dashed: true
    },
    { label: t("pluginAnalysis.outputLevel"), x, y: data.output_envelope.map(decibels) }
  ]
}
const series = computed(() => [
  ...makeSeries(props.report),
  ...(props.comparison
    ? makeSeries(props.comparison)
        .filter((s) => s.label !== "1:1")
        .map((s) => ({
          ...s,
          label: `${t("pluginAnalysis.chain2")} · ${s.label}`,
          color: "var(--ui-color-action)",
          dashed: true
        }))
    : [])
])
</script>
<template>
  <section class="dynamics-panel">
    <PluginAnalysisPlot
      :title="view === 'ramp' ? t('pluginAnalysis.ramp') : t('pluginAnalysis.attackRelease')"
      :x-label="view === 'ramp' ? t('pluginAnalysis.inputLevel') : 'ms'"
      :x-unit="view === 'ramp' ? 'dBFS' : 'ms'"
      y-unit="dBFS"
      :y-label="t('pluginAnalysis.outputLevel')"
      :series="series"
      :smooth="view === 'ramp'"
    />
    <footer class="toolbar">
      <UiSegmentedControl
        v-model="view"
        :options="views"
        :label="t('pluginAnalysis.dynamicsView')"
        size="compact"
        required
      /><UiSegmentedControl
        v-model="channel"
        :options="channels"
        :label="t('pluginAnalysis.channel')"
        size="compact"
        required
      />
    </footer>
  </section>
</template>
<style scoped>
.dynamics-panel {
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
</style>
