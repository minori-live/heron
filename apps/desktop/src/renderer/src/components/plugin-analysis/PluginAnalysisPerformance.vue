<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisReadouts from "./PluginAnalysisReadouts.vue"
import type { PluginAnalysisSnapshot, PluginAnalysisReport } from "@heron/contracts"
const props = defineProps<{ snapshot: PluginAnalysisSnapshot; comparison?: PluginAnalysisReport }>()
const { t } = useI18n()
const report = computed(() => props.snapshot.report!)
const performance = computed(() => report.value.performance)
const budget = computed(() => (performance.value.p99_block_us / performance.value.budget_us) * 100)
const blockSeries = computed(() =>
  [report.value, props.comparison].flatMap((r, index) =>
    r
      ? [
          {
            label: `${props.comparison ? t(`pluginAnalysis.chain${index + 1}`) + " · " : ""}${t("pluginAnalysis.blockTime")}`,
            x: r.performance.block_sizes.map((p) => p.block_size),
            y: r.performance.block_sizes.map((p) => p.average_block_us),
            color: index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)"
          },
          {
            label: `${props.comparison ? t(`pluginAnalysis.chain${index + 1}`) + " · " : ""}P99`,
            x: r.performance.block_sizes.map((p) => p.block_size),
            y: r.performance.block_sizes.map((p) => p.p99_block_us),
            dashed: true,
            color: index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)"
          }
        ]
      : []
  )
)
const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2)
const readouts = computed(() => {
  const p = performance.value
  const memory = props.snapshot.memory
  const unit = t("pluginAnalysis.units.mib")
  return [
    {
      label: t("pluginAnalysis.reportedLatency"),
      value: ((p.reported_latency_samples / report.value.settings.sample_rate) * 1000).toFixed(3),
      unit: "ms",
      detail: `${p.reported_latency_samples} ${t("pluginAnalysis.samples")}`
    },
    {
      label: t("pluginAnalysis.cpuBudget"),
      value: budget.value.toFixed(2),
      unit: "%",
      meter: budget.value,
      tone: budget.value >= 100 ? ("warning" as const) : undefined
    },
    {
      label: t("pluginAnalysis.blockTime"),
      value: p.average_block_us.toFixed(2),
      unit: "μs",
      detail: `${t("pluginAnalysis.blockSize")} · ${report.value.settings.block_size}`
    },
    {
      label: t("pluginAnalysis.percentiles"),
      value: `${p.p95_block_us.toFixed(2)} / ${p.p99_block_us.toFixed(2)} / ${p.maximum_block_us.toFixed(2)}`,
      unit: "μs",
      wide: true
    },
    {
      label: t("pluginAnalysis.deadlineMisses"),
      value: `${p.deadline_misses} / ${p.measured_blocks}`,
      tone: p.deadline_misses ? ("warning" as const) : undefined
    },
    { label: t("pluginAnalysis.workspaceMemory"), value: `≈ ${mib(p.buffer_bytes)}`, unit },
    ...(memory
      ? [
          {
            label: t("pluginAnalysis.loadedMemory"),
            value: mib(memory.loadedBytes - memory.baselineBytes),
            unit
          },
          {
            label: t("pluginAnalysis.peakMemory"),
            value: mib(memory.peakBytes - memory.baselineBytes),
            unit
          },
          {
            label: t("pluginAnalysis.retainedMemory"),
            value: mib(memory.releasedBytes - memory.baselineBytes),
            unit
          }
        ]
      : [])
  ]
})
</script>
<template>
  <section class="performance-panel">
    <PluginAnalysisReadouts :items="readouts" />
    <PluginAnalysisPlot
      :title="t('pluginAnalysis.blockPerformance')"
      :x-label="t('pluginAnalysis.blockSize')"
      x-unit="smp"
      y-unit="μs"
      y-label="μs"
      :series="blockSeries"
    />
  </section>
</template>
<style scoped>
.performance-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
