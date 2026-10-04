<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiTabs, UiSegmentedControl } from "@heron/ui"
import type { PluginAnalysisSnapshot } from "@heron/contracts"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisLinear from "./PluginAnalysisLinear.vue"
import PluginAnalysisHarmonics from "./PluginAnalysisHarmonics.vue"
import PluginAnalysisDistortion from "./PluginAnalysisDistortion.vue"
import PluginAnalysisOscilloscope from "./PluginAnalysisOscilloscope.vue"
import PluginAnalysisDynamics from "./PluginAnalysisDynamics.vue"
import PluginAnalysisModel from "./PluginAnalysisModel.vue"
import PluginAnalysisPerformance from "./PluginAnalysisPerformance.vue"
const props = defineProps<{ snapshot: PluginAnalysisSnapshot }>()
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
</script>
<template>
  <section class="report">
    <UiSegmentedControl
      v-if="snapshot.comparisonEnabled"
      v-model="comparisonMode"
      :options="comparisonModes"
      :label="t('pluginAnalysis.comparisonDisplay')"
      required
    />
    <UiTabs v-model="tab" :items="tabs" :label="t('pluginAnalysis.analysis')" appearance="analysis">
      <template #linear
        ><PluginAnalysisLinear v-if="report" :report="report" :comparison="overlay" />
        <section v-else class="empty-panel">
          <PluginAnalysisPlot
            :title="t('pluginAnalysis.frequency')"
            x-label="Hz"
            x-unit="Hz"
            y-unit="dB"
            :y-label="t('pluginAnalysis.units.db')"
            :series="[]"
            :y-domain="[-6, 6]"
            logarithmic
          /></section
      ></template>
      <template #harmonics
        ><PluginAnalysisHarmonics v-if="report" :report="report" :comparison="overlay" />
        <section v-else class="empty-panel">
          <PluginAnalysisPlot
            :title="t('pluginAnalysis.spectrum2d')"
            x-label="s"
            x-unit="s"
            y-unit="Hz"
            y-label="Hz"
            :series="[]"
            :x-domain="[0, snapshot.settings.sweep_seconds]"
            :y-domain="[0, snapshot.settings.sample_rate / 2]"
          /></section
      ></template>
      <template #distortion
        ><PluginAnalysisDistortion v-if="report" :report="report" :comparison="overlay" />
        <section v-else class="empty-panel"></section
      ></template>
      <template #oscilloscope
        ><PluginAnalysisOscilloscope v-if="report" :report="report" :comparison="overlay" />
        <section v-else class="empty-panel"></section
      ></template>
      <template #dynamics
        ><PluginAnalysisDynamics v-if="report" :report="report" :comparison="overlay" />
        <section v-else class="empty-panel"></section
      ></template>
      <template #model
        ><PluginAnalysisModel v-if="report" :report="report" :comparison="overlay" />
        <section v-else class="empty-panel">
          <PluginAnalysisPlot
            :title="t('pluginAnalysis.nonlinearity')"
            x-unit="FS"
            y-unit="FS"
            :x-label="t('pluginAnalysis.input')"
            :y-label="t('pluginAnalysis.output')"
            :series="[]"
            :x-domain="[-1, 1]"
            :y-domain="[-1, 1]"
          /></section
      ></template>
      <template #performance
        ><PluginAnalysisPerformance
          v-if="report"
          :snapshot="{ ...snapshot, report }"
          :comparison="overlay" />
        <section v-else class="empty-performance"></section
      ></template>
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
.empty-panel {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.empty-performance {
  flex: 1;
}
</style>
