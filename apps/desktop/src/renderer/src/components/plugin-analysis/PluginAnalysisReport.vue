<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiTabs } from "@heron/ui"
import type { PluginAnalysisSnapshot } from "@heron/contracts"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisLinear from "./PluginAnalysisLinear.vue"
import PluginAnalysisHarmonics from "./PluginAnalysisHarmonics.vue"
import PluginAnalysisDistortion from "./PluginAnalysisDistortion.vue"
import PluginAnalysisOscilloscope from "./PluginAnalysisOscilloscope.vue"
import PluginAnalysisModel from "./PluginAnalysisModel.vue"
import PluginAnalysisPerformance from "./PluginAnalysisPerformance.vue"
const props = defineProps<{ snapshot: PluginAnalysisSnapshot }>()
const { t } = useI18n()
const tab = ref("linear")
const report = computed(() => props.snapshot.report)
const tabs = computed(() =>
  ["linear", "harmonics", "distortion", "oscilloscope", "model", "performance"].map((id) => ({
    id,
    label: t(`pluginAnalysis.tabs.${id}`)
  }))
)
</script>
<template>
  <section class="report">
    <UiTabs v-model="tab" :items="tabs" :label="t('pluginAnalysis.analysis')" appearance="analysis">
      <template #linear
        ><PluginAnalysisLinear v-if="report" :report="report" />
        <section v-else class="empty-panel">
          <PluginAnalysisPlot
            :title="t('pluginAnalysis.frequency')"
            x-label="Hz"
            :y-label="t('pluginAnalysis.units.db')"
            :series="[]"
            :y-domain="[-6, 6]"
            logarithmic
          /></section
      ></template>
      <template #harmonics
        ><PluginAnalysisHarmonics v-if="report" :report="report" />
        <section v-else class="empty-panel">
          <PluginAnalysisPlot
            :title="t('pluginAnalysis.spectrum2d')"
            x-label="s"
            y-label="Hz"
            :series="[]"
            :x-domain="[0, snapshot.settings.sweep_seconds]"
            :y-domain="[0, snapshot.settings.sample_rate / 2]"
          /></section
      ></template>
      <template #distortion
        ><PluginAnalysisDistortion v-if="report" :report="report" />
        <section v-else class="empty-panel"></section
      ></template>
      <template #oscilloscope
        ><PluginAnalysisOscilloscope v-if="report" :report="report" />
        <section v-else class="empty-panel"></section
      ></template>
      <template #model
        ><PluginAnalysisModel v-if="report" :report="report" />
        <section v-else class="empty-panel">
          <PluginAnalysisPlot
            :title="t('pluginAnalysis.nonlinearity')"
            :x-label="t('pluginAnalysis.input')"
            :y-label="t('pluginAnalysis.output')"
            :series="[]"
            :x-domain="[-1, 1]"
            :y-domain="[-1, 1]"
          /></section
      ></template>
      <template #performance
        ><PluginAnalysisPerformance v-if="report" :snapshot="snapshot" />
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
