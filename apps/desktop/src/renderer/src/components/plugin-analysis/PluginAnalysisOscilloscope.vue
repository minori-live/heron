<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiNumberInput, UiSegmentedControl, type UiAnalysisSeries } from "@heron/ui"
import type { PluginAnalysisReport } from "@heron/contracts"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisViewControls from "./PluginAnalysisViewControls.vue"
const props = defineProps<{ report: PluginAnalysisReport; comparison?: PluginAnalysisReport }>()
const { t } = useI18n()
const channel = ref("0")
const waveform = ref("sine")
const domain = ref("time")
const delay = ref<number | null>(null)
const scope = computed(() => props.report.oscilloscopes[Number(channel.value)] ?? null)
const channels = computed(() => [
  { value: "0", label: props.report.settings.mid_side ? "M" : "L" },
  { value: "1", label: props.report.settings.mid_side ? "S" : "R" }
])
const waveforms = computed(() => [
  { value: "sine", label: t("pluginAnalysis.waveSine") },
  { value: "square", label: t("pluginAnalysis.waveSquare") },
  { value: "saw", label: t("pluginAnalysis.waveSaw") },
  { value: "triangle", label: t("pluginAnalysis.waveTriangle") }
])
const domains = computed(() => [
  { value: "time", label: t("pluginAnalysis.time") },
  { value: "waveshaping", label: t("pluginAnalysis.waveshaping") }
])
const effectiveDelay = computed(() => delay.value ?? scope.value?.delay_samples ?? 0)
const makeSeries = (report: PluginAnalysisReport): UiAnalysisSeries[] => {
  const source = report.oscilloscopes[Number(channel.value)]
  const selected = source?.waveforms.find((w) => w.waveform === waveform.value)
  if (!selected || !source) return []
  const count = Math.min(selected.input.length, selected.output.length)
  if (count === 0) return []
  if (domain.value === "waveshaping") {
    const shift = Math.max(0, delay.value ?? source.delay_samples) / source.sample_stride
    const points = Math.max(0, Math.floor(count - 1 - shift) + 1)
    return [
      {
        label: t("pluginAnalysis.output"),
        x: selected.input.slice(0, points),
        // Delay remains in audio samples; interpolate between retained points
        // when downsampling makes that delay a fractional display index.
        y: Array.from({ length: points }, (_, i) => {
          const position = i + shift
          const left = Math.floor(position)
          const fraction = position - left
          const a = selected.output[left]!
          const b = selected.output[Math.min(left + 1, count - 1)]!
          return a + (b - a) * fraction
        })
      }
    ]
  }
  const x = Array.from(
    { length: count },
    (_, i) => (i * source.sample_stride * 1000) / source.sample_rate
  )
  return [
    {
      label: t("pluginAnalysis.input"),
      x,
      y: selected.input,
      color: "var(--ui-color-text-faint)",
      dashed: true
    },
    { label: t("pluginAnalysis.output"), x, y: selected.output }
  ]
}
const series = computed(() => [
  ...makeSeries(props.report),
  ...(props.comparison
    ? makeSeries(props.comparison)
        .filter((s) => s.label === t("pluginAnalysis.output"))
        .map((s) => ({
          ...s,
          label: t("pluginAnalysis.chain2"),
          color: "var(--ui-color-action)",
          dashed: true
        }))
    : [])
])
</script>
<template>
  <section class="oscilloscope-panel">
    <PluginAnalysisPlot
      :title="t('pluginAnalysis.tabs.oscilloscope')"
      :x-label="domain === 'time' ? 'ms' : t('pluginAnalysis.input')"
      :x-unit="domain === 'time' ? 'ms' : 'FS'"
      y-unit="FS"
      :y-label="t('pluginAnalysis.amplitude')"
      :series="series"
      :smooth="false"
    />
    <PluginAnalysisViewControls>
      <UiSegmentedControl
        v-model="domain"
        :options="domains"
        :label="t('pluginAnalysis.displayMode')"
        size="compact"
        required
      /><UiSegmentedControl
        v-model="waveform"
        :options="waveforms"
        :label="t('pluginAnalysis.waveform')"
        size="compact"
        required
      /><UiSegmentedControl
        v-model="channel"
        :options="channels"
        :label="t('pluginAnalysis.channel')"
        size="compact"
        required
      /><label class="delay"
        ><span>{{ t("pluginAnalysis.delaySamples") }}</span
        ><UiNumberInput
          :model-value="effectiveDelay"
          :min="0"
          :max="2000"
          :step="1"
          suffix="smp"
          :aria-label="t('pluginAnalysis.delaySamples')"
          @update:model-value="delay = $event"
      /></label>
    </PluginAnalysisViewControls>
  </section>
</template>
<style scoped>
.oscilloscope-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.delay {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.delay > :deep(.ui-number-input) {
  width: 110px;
}
</style>
