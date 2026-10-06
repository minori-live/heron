<script setup lang="ts">
import { computed, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton, UiNumberInput, UiSelect, type UiAnalysisSeries } from "@heron/ui"
import type { PluginAnalysisReport } from "@heron/contracts"
import { EQ_FIT_DEFAULT_QUOTA, EQ_FIT_MAX_QUOTA } from "../../lib/eq-fit"
import { eqFitMeasurement } from "./eqFitMeasurement"
import { useEqFit } from "./useEqFit"
import PluginAnalysisEqFitResult from "./PluginAnalysisEqFitResult.vue"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"

const props = withDefaults(
  defineProps<{
    report: PluginAnalysisReport
    comparison?: PluginAnalysisReport
    input: number
    output: number
    reportId?: string | null
    reportRevision?: number | null
    revision?: number
    selectionRevision?: number
    mode?: string
    stale?: boolean
  }>(),
  {
    comparison: undefined,
    reportId: undefined,
    reportRevision: undefined,
    revision: undefined,
    selectionRevision: undefined,
    mode: "single",
    stale: false
  }
)
const { t } = useI18n()
const quota = shallowRef<number | null>(EQ_FIT_DEFAULT_QUOTA)
const chain = shallowRef("")
const chainOptions = computed(() => [
  { value: "primary", label: t("pluginAnalysis.chain1") },
  { value: "comparison", label: t("pluginAnalysis.chain2") }
])
const targetReport = computed(() => {
  if (props.mode === "parallel" && !chain.value) return undefined
  return props.mode === "comparison" || (props.mode === "parallel" && chain.value === "comparison")
    ? props.comparison
    : props.report
})
const response = computed(() =>
  targetReport.value?.responses.find(
    (item) => item.input === props.input && item.output === props.output
  )
)
const measurement = computed(() =>
  targetReport.value && response.value ? eqFitMeasurement(targetReport.value, response.value) : null
)
const validQuota = computed(
  () =>
    quota.value !== null &&
    Number.isInteger(quota.value) &&
    quota.value >= 1 &&
    quota.value <= EQ_FIT_MAX_QUOTA
)
const unavailable = computed(() => {
  if (props.mode === "difference") return "difference"
  if (props.stale) return "stale"
  if (props.mode === "parallel" && !chain.value) return "choose-chain"
  if (!response.value || !targetReport.value) return "missing-path"
  if (!validQuota.value) return "invalid-quota"
  return measurement.value?.failure ?? null
})
const { status, result, error, start, cancel } = useEqFit(() => [
  // Polling delivers cloned reports. Stable report identity keeps a valid result
  // across those clones; bare component users fall back to report reference.
  props.reportId ?? props.report,
  props.reportRevision,
  props.revision,
  props.reportId ? undefined : props.comparison,
  props.input,
  props.output,
  props.selectionRevision,
  props.mode,
  props.stale,
  chain.value,
  quota.value
])
const warnings = computed(() => [
  ...(measurement.value?.warnings ?? []),
  ...(result.value?.warnings ?? [])
])
const targetLabel = computed(() => {
  const selected = response.value
  if (!selected) return ""
  const name = (index: number) =>
    targetReport.value?.settings.mid_side ? (index ? "S" : "M") : index ? "R" : "L"
  const chainLabel =
    props.mode === "single"
      ? ""
      : `${t(`pluginAnalysis.chain${props.mode === "comparison" || (props.mode === "parallel" && chain.value === "comparison") ? 2 : 1}`)} · `
  return `${chainLabel}${name(selected.input)} → ${name(selected.output)}`
})
const plotSeries = computed<UiAnalysisSeries[]>(() => {
  if (!response.value) return []
  return [
    {
      label: targetLabel.value,
      x: response.value.frequency_hz,
      y: response.value.magnitude_db,
      color: "var(--ui-signal-mixer-input)"
    },
    ...(result.value
      ? [
          {
            label: `${t("pluginAnalysis.eqFit.fitted")} · ${targetLabel.value}`,
            x: response.value.frequency_hz,
            y: result.value.fittedDb,
            color: "var(--ui-color-warning)",
            dashed: true
          }
        ]
      : [])
  ]
})
const responseDomain = computed<readonly [number, number]>(() => {
  const values = plotSeries.value.flatMap((series) =>
    series.y.filter((value): value is number => value !== null && Number.isFinite(value))
  )
  return [
    Math.min(-6, Math.floor(Math.min(...values, 0) / 6) * 6),
    Math.max(6, Math.ceil(Math.max(...values, 0) / 6) * 6)
  ]
})
function fit(): void {
  if (unavailable.value || !response.value || !targetReport.value || quota.value === null) return
  // Copy only the selected raw report samples. Display interpolation and phase
  // compensation never enter the fit; structured cloning owns worker input.
  start({
    sampleRate: targetReport.value.settings.sample_rate,
    frequencyHz: [...response.value.frequency_hz],
    magnitudeDb: [...response.value.magnitude_db],
    quota: quota.value
  })
}
</script>

<template>
  <section
    class="eq-fit"
    :aria-label="t('pluginAnalysis.eqFit.title')"
    :aria-busy="status === 'running'"
  >
    <div class="fit-controls">
      <strong class="fit-title">{{ t("pluginAnalysis.eqFit.title") }}</strong>
      <UiSelect
        v-if="mode === 'parallel'"
        v-model="chain"
        :options="chainOptions"
        size="sm"
        :placeholder="t('pluginAnalysis.eqFit.chooseChain')"
        :aria-label="t('pluginAnalysis.eqFit.chain')"
      />
      <label class="quota-control">
        <span>{{ t("pluginAnalysis.eqFit.quota") }}</span>
        <UiNumberInput
          v-model="quota"
          :min="1"
          :max="EQ_FIT_MAX_QUOTA"
          :step="1"
          size="sm"
          :invalid="!validQuota"
          :aria-label="t('pluginAnalysis.eqFit.quota')"
        />
      </label>
      <UiButton size="sm" :disabled="!!unavailable || status === 'running'" @click="fit">
        {{
          t(
            status === "running"
              ? "pluginAnalysis.eqFit.running"
              : result
                ? "pluginAnalysis.eqFit.again"
                : "pluginAnalysis.eqFit.run"
          )
        }}
      </UiButton>
      <UiButton v-if="status === 'running'" size="sm" variant="secondary" @click="cancel">{{
        t("pluginAnalysis.eqFit.cancel")
      }}</UiButton>
    </div>
    <p v-if="unavailable" class="fit-note" role="status">
      {{ t(`pluginAnalysis.eqFit.unavailable.${unavailable}`) }}
    </p>
    <p v-else-if="status === 'running' || status === 'cancelled'" class="fit-note" role="status">
      {{ t(`pluginAnalysis.eqFit.${status}`) }}
    </p>
    <p v-if="error" class="fit-error" role="alert">
      {{ t(`pluginAnalysis.eqFit.errors.${error}`) }}
    </p>
    <ul v-if="warnings.length" class="fit-warnings">
      <li v-for="warning in warnings" :key="warning">
        {{ t(`pluginAnalysis.eqFit.warnings.${warning}`) }}
      </li>
    </ul>
    <PluginAnalysisPlot
      :title="t('pluginAnalysis.frequency')"
      x-label="Hz"
      x-unit="Hz"
      :y-label="t('pluginAnalysis.units.db')"
      y-unit="dB"
      :series="plotSeries"
      :y-domain="responseDomain"
      :smooth="false"
      logarithmic
    />
    <PluginAnalysisEqFitResult
      v-if="result && response"
      :result="result"
      :frequencies="response.frequency_hz"
      :quota="quota ?? EQ_FIT_DEFAULT_QUOTA"
    />
  </section>
</template>

<style scoped>
.eq-fit {
  flex: none;
  padding: 12px 16px;
  background: var(--ui-color-surface-sunken);
}
.eq-fit > :deep(.plugin-analysis-plot) {
  min-height: 300px;
  margin-top: 12px;
}
.eq-fit :deep(figcaption) {
  flex-wrap: wrap;
}
.fit-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.fit-title {
  font-size: var(--ui-type-size-control);
}
.fit-controls > :deep(.ui-select-shell) {
  width: 160px;
}
.quota-control {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: var(--ui-type-size-caption);
}
.quota-control > :deep(.ui-number-input) {
  width: 70px;
}
.fit-note,
.fit-warnings,
.fit-error {
  margin: 8px 0 0;
  font-size: var(--ui-type-size-caption);
}
.fit-note {
  color: var(--ui-color-text-muted);
}
.fit-warnings {
  padding-left: 18px;
  color: var(--ui-color-warning);
}
.fit-error {
  color: var(--ui-color-danger);
}
</style>
