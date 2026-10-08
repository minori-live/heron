<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiTabs, UiSegmentedControl } from "@heron/ui"
import type { PluginAnalysisEqFitSelection, PluginAnalysisSnapshot } from "@heron/contracts"
import type { PluginAnalysisAxisUnit } from "./pluginAnalysisAxes"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisLinear from "./PluginAnalysisLinear.vue"
import PluginAnalysisHarmonics from "./PluginAnalysisHarmonics.vue"
import PluginAnalysisDistortion from "./PluginAnalysisDistortion.vue"
import PluginAnalysisOscilloscope from "./PluginAnalysisOscilloscope.vue"
import PluginAnalysisDynamics from "./PluginAnalysisDynamics.vue"
import PluginAnalysisModel from "./PluginAnalysisModel.vue"
import PluginAnalysisPerformance from "./PluginAnalysisPerformance.vue"
const props = defineProps<{ snapshot: PluginAnalysisSnapshot }>()
const emit = defineEmits<{
  eqFitSelection: [selection: PluginAnalysisEqFitSelection | null]
  openEqFit: []
}>()
const { t } = useI18n()
const tab = ref("linear")
const comparisonMode = ref("parallel")
const report = computed(() =>
  !props.snapshot.comparisonEnabled
    ? props.snapshot.report
    : comparisonMode.value === "difference"
      ? props.snapshot.differenceReport
      : comparisonMode.value === "comparison"
        ? props.snapshot.comparisonReport
        : props.snapshot.report
)
const overlay = computed(() =>
  props.snapshot.comparisonEnabled && comparisonMode.value === "parallel"
    ? (props.snapshot.comparisonReport ?? undefined)
    : undefined
)
const comparisonModes = computed(() =>
  ["parallel", "difference", "primary", "comparison"].map((value) => ({
    value,
    label: t(`pluginAnalysis.compare_${value}`)
  }))
)
const tabs = computed(() =>
  ["linear", "harmonics", "distortion", "oscilloscope", "dynamics", "model", "performance"].map(
    (id) => ({
      id,
      label: t(`pluginAnalysis.tabs.${id}`)
    })
  )
)
const measuring = computed(
  () => props.snapshot.status === "running" || props.snapshot.status === "debouncing"
)
interface EmptyPlot {
  title: string
  xLabel: string
  yLabel: string
  xUnit: PluginAnalysisAxisUnit
  yUnit: PluginAnalysisAxisUnit
  xDomain?: readonly [number, number]
  yDomain?: readonly [number, number]
  logarithmic?: boolean
}
// Axes of each view before its first result, so the empty state keeps the plot's frame.
const emptyPlot = computed<EmptyPlot>(() => {
  const { settings } = props.snapshot
  const level = t("pluginAnalysis.inputLevel")
  return (
    {
      linear: {
        title: t("pluginAnalysis.frequency"),
        xLabel: "Hz",
        yLabel: t("pluginAnalysis.units.db"),
        xUnit: "Hz",
        yUnit: "dB",
        yDomain: [-6, 6],
        logarithmic: true
      },
      harmonics: {
        title: t("pluginAnalysis.spectrum2d"),
        xLabel: "s",
        yLabel: "Hz",
        xUnit: "s",
        yUnit: "Hz",
        xDomain: [0, settings.sweep_seconds],
        yDomain: [0, settings.sample_rate / 2]
      },
      distortion: {
        title: t("pluginAnalysis.thdValue"),
        xLabel: "Hz",
        yLabel: t("pluginAnalysis.units.dbfs"),
        xUnit: "Hz",
        yUnit: "dBFS",
        xDomain: [settings.start_hz, settings.end_hz],
        yDomain: [-160, 12]
      },
      oscilloscope: {
        title: t("pluginAnalysis.tabs.oscilloscope"),
        xLabel: "ms",
        yLabel: t("pluginAnalysis.amplitude"),
        xUnit: "ms",
        yUnit: "FS",
        xDomain: [0, 10],
        yDomain: [-1, 1]
      },
      dynamics: {
        title: t("pluginAnalysis.ramp"),
        xLabel: level,
        yLabel: t("pluginAnalysis.outputLevel"),
        xUnit: "dBFS",
        yUnit: "dBFS",
        xDomain: [settings.ramp_start_dbfs, settings.ramp_end_dbfs],
        yDomain: [settings.ramp_start_dbfs, settings.ramp_end_dbfs]
      },
      model: {
        title: t("pluginAnalysis.nonlinearity"),
        xLabel: t("pluginAnalysis.input"),
        yLabel: t("pluginAnalysis.output"),
        xUnit: "FS",
        yUnit: "FS",
        xDomain: [-1, 1],
        yDomain: [-1, 1]
      },
      performance: {
        title: t("pluginAnalysis.blockPerformance"),
        xLabel: t("pluginAnalysis.blockSize"),
        yLabel: "μs",
        xUnit: "smp",
        yUnit: "μs",
        xDomain: [64, 1024],
        yDomain: [0, 100]
      }
    } satisfies Record<string, EmptyPlot>
  )[tab.value as "linear"]
})
</script>
<template>
  <section class="report">
    <UiTabs v-model="tab" :items="tabs" :label="t('pluginAnalysis.analysis')" appearance="analysis">
      <template v-if="snapshot.comparisonEnabled" #list-end
        ><span class="comparison-label" aria-hidden="true">{{ t("pluginAnalysis.show") }}</span
        ><UiSegmentedControl
          v-model="comparisonMode"
          :options="comparisonModes"
          :label="t('pluginAnalysis.comparisonDisplay')"
          size="compact"
          required
      /></template>
      <template v-for="item in tabs" :key="item.id" #[item.id]
        ><section v-if="!report" class="empty-panel">
          <PluginAnalysisPlot v-bind="emptyPlot" :series="[]"
            ><template #overlay
              ><div class="empty-state">
                <p class="empty-title">
                  {{
                    measuring ? t("pluginAnalysis.measuringTitle") : t("pluginAnalysis.emptyTitle")
                  }}
                </p>
                <p v-if="!measuring" class="empty-description">
                  {{ t("pluginAnalysis.emptyDescription") }}
                </p>
              </div></template
            ></PluginAnalysisPlot
          >
        </section>
        <PluginAnalysisLinear
          v-else-if="item.id === 'linear'"
          :report="report"
          :comparison="overlay"
          :report-id="snapshot.reportId"
          :report-revision="snapshot.reportRevision"
          :revision="snapshot.revision"
          :comparison-mode="snapshot.comparisonEnabled ? comparisonMode : 'single'"
          :stale="snapshot.reportRevision !== snapshot.revision"
          @eq-fit-selection="emit('eqFitSelection', $event)"
          @open-eq-fit="emit('openEqFit')" />
        <PluginAnalysisHarmonics
          v-else-if="item.id === 'harmonics'"
          :report="report"
          :comparison="overlay" />
        <PluginAnalysisDistortion
          v-else-if="item.id === 'distortion'"
          :report="report"
          :comparison="overlay" />
        <PluginAnalysisOscilloscope
          v-else-if="item.id === 'oscilloscope'"
          :report="report"
          :comparison="overlay" />
        <PluginAnalysisDynamics
          v-else-if="item.id === 'dynamics'"
          :report="report"
          :comparison="overlay" />
        <PluginAnalysisModel
          v-else-if="item.id === 'model'"
          :report="report"
          :comparison="overlay" />
        <PluginAnalysisPerformance v-else :snapshot="{ ...snapshot, report }" :comparison="overlay"
      /></template>
    </UiTabs>
  </section>
</template>
<style scoped>
.report {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.report > :deep(.ui-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.comparison-label {
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-caption);
}
.empty-panel {
  display: flex;
  flex: 1;
  min-height: 0;
}
.empty-state {
  display: grid;
  gap: 6px;
  max-width: 320px;
  padding: 14px 20px;
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  background: color-mix(in srgb, var(--ui-color-surface) 92%, transparent);
  text-align: center;
}
.empty-state p {
  margin: 0;
}
.empty-title {
  color: var(--ui-color-text);
  font-size: var(--ui-type-size-panel-title);
  font-weight: var(--ui-type-weight-medium);
}
.empty-description {
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
}
</style>
