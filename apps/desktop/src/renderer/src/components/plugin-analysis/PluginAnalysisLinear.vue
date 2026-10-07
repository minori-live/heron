<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue"
import { useI18n } from "vue-i18n"
import {
  UiButton,
  UiCheckbox,
  UiSegmentedControl,
  UiSelect,
  type UiAnalysisSeries
} from "@heron/ui"
import type { PluginAnalysisEqFitSelection, PluginAnalysisReport } from "@heron/contracts"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisViewControls from "./PluginAnalysisViewControls.vue"
const props = defineProps<{
  report: PluginAnalysisReport
  comparison?: PluginAnalysisReport
  reportId?: string | null
  reportRevision?: number | null
  revision?: number
  comparisonMode?: string
  stale?: boolean
}>()
const emit = defineEmits<{
  eqFitSelection: [selection: PluginAnalysisEqFitSelection | null]
  openEqFit: []
}>()
const { t } = useI18n()
const view = ref("magnitude")
const path = ref("direct")
const compensate = ref(false)
const stored = shallowRef<UiAnalysisSeries[]>([])
const eqFitMode = computed(() => props.comparisonMode ?? (props.comparison ? "parallel" : "single"))
const eqFitEntryVisible = computed(
  () => view.value === "magnitude" && path.value !== "direct" && eqFitMode.value !== "difference"
)
const eqFitSelection = computed<PluginAnalysisEqFitSelection | null>(() => {
  if (!eqFitEntryVisible.value || props.stale || !props.reportId || props.reportRevision == null)
    return null
  const response = props.report.responses[Number(path.value)]
  const mode = eqFitMode.value
  if (
    !response ||
    (mode !== "single" && mode !== "primary" && mode !== "comparison" && mode !== "parallel")
  )
    return null
  return {
    reportId: props.reportId,
    reportRevision: props.reportRevision,
    input: response.input,
    output: response.output,
    mode
  }
})
watch(eqFitSelection, (selection) => emit("eqFitSelection", selection), {
  immediate: true,
  flush: "sync"
})
onBeforeUnmount(() => emit("eqFitSelection", null))
const modes = computed(() => [
  { value: "magnitude", label: t("pluginAnalysis.magnitude") },
  { value: "phase", label: t("pluginAnalysis.phase") },
  { value: "impulse", label: t("pluginAnalysis.impulse") }
])
const paths = computed(() => [
  { value: "direct", label: t("pluginAnalysis.bothChannels") },
  ...props.report.responses.map((p, i) => ({
    value: String(i),
    label: `${channelName(p.input)} → ${channelName(p.output)}`
  }))
])
function channelName(index: number, report = props.report): string {
  if (report.settings.mid_side) return index ? "S" : "M"
  return index ? "R" : "L"
}
const makeSeries = (report: PluginAnalysisReport, chain?: number): UiAnalysisSeries[] =>
  report.responses
    .filter((p) => {
      if (path.value === "direct") return p.input === p.output
      const selected = props.report.responses[Number(path.value)]
      return selected && p.input === selected.input && p.output === selected.output
    })
    .map((p, index) => ({
      label: `${chain === undefined ? "" : t(`pluginAnalysis.chain${chain + 1}`) + " · "}${channelName(p.input, report)} → ${channelName(p.output, report)}`,
      // Colour identifies the channel path; the comparison chain is dashed.
      color: index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)",
      dashed: chain === 1,
      x:
        view.value === "impulse"
          ? p.impulse.map(
              (_, i) =>
                ((p.impulse_start_samples +
                  i * p.impulse_stride -
                  (compensate.value ? (p.delay_samples ?? 0) : 0)) /
                  report.settings.sample_rate) *
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
                        report.settings.sample_rate
                      : 0)
              )
    }))
const series = computed(() => [
  ...makeSeries(props.report, props.comparison ? 0 : undefined),
  ...(props.comparison ? makeSeries(props.comparison, 1) : [])
])
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
      :x-unit="view === 'impulse' ? 'ms' : 'Hz'"
      :y-unit="view === 'magnitude' ? 'dB' : view === 'phase' ? '°' : 'FS'"
      :y-label="
        view === 'magnitude'
          ? t('pluginAnalysis.units.db')
          : view === 'phase'
            ? '°'
            : t('pluginAnalysis.amplitude')
      "
      :logarithmic="view !== 'impulse'"
      :smooth="view === 'magnitude'"
      :series="displayed"
      :y-domain="responseDomain"
    />
    <PluginAnalysisViewControls>
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
        class="stored-actions"
        ><UiButton size="sm" variant="secondary" @click="store">{{
          t("pluginAnalysis.store")
        }}</UiButton
        ><UiButton size="sm" variant="ghost" :disabled="!stored.length" @click="stored = []">{{
          t("pluginAnalysis.clear")
        }}</UiButton
        ><UiButton
          v-if="eqFitEntryVisible"
          size="sm"
          variant="secondary"
          :disabled="!eqFitSelection"
          @click="emit('openEqFit')"
          >{{ t("pluginAnalysis.eqFit.open") }}</UiButton
        ></span
      >
    </PluginAnalysisViewControls>
  </section>
</template>
<style scoped>
.linear-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.linear-panel :deep(.ui-select-shell) {
  width: 140px;
}
.stored-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
</style>
