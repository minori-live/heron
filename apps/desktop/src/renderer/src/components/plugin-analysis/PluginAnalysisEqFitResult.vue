<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import type { EqFitSuccess } from "./eqFitWorkerTypes"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"

const props = defineProps<{ result: EqFitSuccess; frequencies: number[]; quota: number }>()
const { t, n } = useI18n()
const residualSeries = computed(() => [
  {
    label: t("pluginAnalysis.eqFit.residual"),
    x: props.frequencies,
    y: props.result.residualDb,
    color: "var(--ui-color-action)"
  }
])
const residualDomain = computed<readonly [number, number]>(() => {
  // Preserve the analysis workspace's 1 dB grid interval policy (six divisions).
  const extent = Math.max(3, props.result.maxErrorDb * 1.1)
  return [-extent, extent]
})
const decimal = (value: number, digits = 3) => n(value, { maximumFractionDigits: digits })
</script>

<template>
  <section class="fit-result" role="region" :aria-label="t('pluginAnalysis.eqFit.result')">
    <dl class="fit-summary">
      <div>
        <dt>{{ t("pluginAnalysis.eqFit.overallGain") }}</dt>
        <dd>{{ decimal(result.overallGainDb) }} {{ t("pluginAnalysis.units.db") }}</dd>
      </div>
      <div>
        <dt>{{ t("pluginAnalysis.eqFit.rms") }}</dt>
        <dd>{{ decimal(result.rmsErrorDb) }} {{ t("pluginAnalysis.units.db") }}</dd>
      </div>
      <div>
        <dt>{{ t("pluginAnalysis.eqFit.maximum") }}</dt>
        <dd>{{ decimal(result.maxErrorDb) }} {{ t("pluginAnalysis.units.db") }}</dd>
      </div>
      <div>
        <dt>{{ t("pluginAnalysis.eqFit.baseline") }}</dt>
        <dd>{{ decimal(result.baselineRmsErrorDb) }} {{ t("pluginAnalysis.units.db") }}</dd>
      </div>
      <div>
        <dt>{{ t("pluginAnalysis.eqFit.elapsed") }}</dt>
        <dd>{{ decimal(result.elapsedMs, 0) }} ms</dd>
      </div>
    </dl>
    <p class="fit-note">
      {{ t("pluginAnalysis.eqFit.used", { used: result.sections.length, quota }) }}
    </p>
    <table v-if="result.sections.length" class="fit-table">
      <caption class="fit-caption">
        {{
          t("pluginAnalysis.eqFit.parameters")
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t("pluginAnalysis.eqFit.filter") }}</th>
          <th scope="col">{{ t("pluginAnalysis.eqFit.frequency") }}</th>
          <th scope="col">{{ t("pluginAnalysis.eqFit.gain") }}</th>
          <th scope="col">Q</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(section, index) in result.sections" :key="index">
          <td>{{ t(`pluginAnalysis.eqFit.types.${section.type}`) }}</td>
          <td>{{ decimal(section.frequencyHz, 1) }} Hz</td>
          <td>{{ decimal(section.gainDb) }} {{ t("pluginAnalysis.units.db") }}</td>
          <td>{{ decimal(section.q) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="fit-note">{{ t("pluginAnalysis.eqFit.flat") }}</p>
    <PluginAnalysisPlot
      :title="t('pluginAnalysis.eqFit.residual')"
      x-label="Hz"
      x-unit="Hz"
      :y-label="t('pluginAnalysis.units.db')"
      y-unit="dB"
      :series="residualSeries"
      :y-domain="residualDomain"
      :smooth="false"
      logarithmic
    />
    <p class="fit-note">{{ t("pluginAnalysis.eqFit.convention") }}</p>
  </section>
</template>

<style scoped>
.fit-result {
  min-width: 0;
}
.fit-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  font-size: var(--ui-type-size-caption);
}
.fit-summary dd {
  margin: 4px 0 0;
  color: var(--ui-color-text);
  font-family: var(--ui-type-family-data);
}
.fit-note {
  margin: 8px 0;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
}
.fit-table {
  display: block;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}
.fit-table th,
.fit-table td {
  padding: 5px 10px;
  text-align: right;
  border-bottom: 1px solid var(--ui-color-border);
}
.fit-table th:first-child,
.fit-table td:first-child {
  text-align: left;
}
.fit-caption {
  text-align: left;
  margin-bottom: 4px;
  color: var(--ui-color-text-muted);
}
.fit-result > :deep(.plugin-analysis-plot) {
  min-height: 240px;
  margin-top: 12px;
}
.fit-result :deep(figcaption) {
  flex-wrap: wrap;
}
</style>
