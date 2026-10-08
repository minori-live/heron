<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { intlLocale } from "../../i18n"
import type { EqFitSuccess } from "./eqFitWorkerTypes"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisReadouts from "./PluginAnalysisReadouts.vue"
import PluginAnalysisEqFitPreset from "./PluginAnalysisEqFitPreset.vue"

const props = defineProps<{ result: EqFitSuccess; frequencies: number[]; quota: number }>()
const { t, locale } = useI18n()
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
const decimal = (value: number, digits = 3) =>
  value.toLocaleString(intlLocale(locale.value), { maximumFractionDigits: digits })
const summary = computed(() => {
  const db = t("pluginAnalysis.units.db")
  const r = props.result
  return [
    { label: t("pluginAnalysis.eqFit.overallGain"), value: decimal(r.overallGainDb), unit: db },
    { label: t("pluginAnalysis.eqFit.rms"), value: decimal(r.rmsErrorDb), unit: db },
    { label: t("pluginAnalysis.eqFit.maximum"), value: decimal(r.maxErrorDb), unit: db },
    { label: t("pluginAnalysis.eqFit.baseline"), value: decimal(r.baselineRmsErrorDb), unit: db },
    { label: t("pluginAnalysis.eqFit.elapsed"), value: decimal(r.elapsedMs, 0), unit: "ms" }
  ]
})
</script>

<template>
  <section class="fit-result" role="region" :aria-label="t('pluginAnalysis.eqFit.result')">
    <PluginAnalysisReadouts :items="summary" />
    <div class="fit-details">
      <div class="fit-parameters">
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
        <PluginAnalysisEqFitPreset :result="result" />
      </div>
      <PluginAnalysisPlot
        class="fit-residual"
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
    </div>
    <p class="fit-convention">{{ t("pluginAnalysis.eqFit.convention") }}</p>
  </section>
</template>

<style scoped>
.fit-result {
  display: flex;
  flex-direction: column;
  flex: 1 0 auto;
  min-width: 0;
  border-top: 1px solid var(--ui-color-border);
}
.fit-details {
  display: flex;
  flex: 1 0 auto;
  flex-wrap: wrap;
  min-width: 0;
  border-bottom: 1px solid var(--ui-color-border);
}
.fit-parameters {
  flex: 1 1 260px;
  min-width: 0;
  max-width: 100%;
  padding: 12px 16px 16px;
  background: var(--ui-color-surface);
}
.fit-residual {
  flex: 3 1 360px;
  min-height: 240px;
}
.fit-note {
  margin: 0 0 10px;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
}
.fit-table {
  display: block;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font: var(--ui-type-size-control) var(--ui-type-family-data);
  font-variant-numeric: tabular-nums;
}
.fit-table th,
.fit-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--ui-color-border);
  text-align: right;
  white-space: nowrap;
}
.fit-table th {
  color: var(--ui-color-text-muted);
  font-weight: var(--ui-type-weight-medium);
}
.fit-table th:first-child,
.fit-table td:first-child {
  padding-left: 0;
  text-align: left;
}
.fit-caption {
  margin-bottom: 4px;
  color: var(--ui-color-text-muted);
  font: var(--ui-type-weight-semibold) var(--ui-type-size-label) var(--ui-type-family-interface);
  letter-spacing: var(--ui-type-tracking-wide);
  text-align: left;
  text-transform: uppercase;
}
.fit-convention {
  margin: 0;
  padding: 10px 16px 16px;
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-caption);
  line-height: var(--ui-type-leading-normal);
}
</style>
