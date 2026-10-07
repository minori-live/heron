<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiSegmentedControl } from "@heron/ui"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisReadouts from "./PluginAnalysisReadouts.vue"
import PluginAnalysisViewControls from "./PluginAnalysisViewControls.vue"
import type { PluginAnalysisReport } from "@heron/contracts"
const props = defineProps<{ report: PluginAnalysisReport; comparison?: PluginAnalysisReport }>()
const { t } = useI18n()
const channel = ref("0")
const mode = ref("tone")
const channels = computed(() => [
  { value: "0", label: props.report.settings.mid_side ? "M" : "L" },
  { value: "1", label: props.report.settings.mid_side ? "S" : "R" }
])
const distortion = computed(() => props.report.distortion[Number(channel.value)] ?? null)
const series = computed(() =>
  [props.report, props.comparison].flatMap((report, index) => {
    const d = report?.distortion[Number(channel.value)]
    if (!d) return []
    const spectrum = mode.value === "tone" ? d.tone_spectrum : d.imd_spectrum
    return [
      {
        label: props.comparison
          ? t(`pluginAnalysis.chain${index + 1}`)
          : t("pluginAnalysis.output"),
        x: spectrum.frequency_hz,
        y: spectrum.magnitude_dbfs,
        color: index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)",
        dashed: index === 1
      }
    ]
  })
)
function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(3)
}
const readouts = computed(() => [
  {
    label: t("pluginAnalysis.thdValue"),
    value: percent(distortion.value?.thd_percent),
    unit: "%",
    detail: distortion.value ? `${distortion.value.tone_hz.toFixed(1)} Hz` : undefined
  },
  {
    label: t("pluginAnalysis.thdPlusNoise"),
    value: percent(distortion.value?.thd_plus_n_percent),
    unit: "%"
  },
  {
    label: t("pluginAnalysis.imd"),
    value: percent(distortion.value?.imd_percent),
    unit: "%",
    detail: t("pluginAnalysis.imdTones")
  }
])
</script>
<template>
  <section class="distortion-panel">
    <PluginAnalysisReadouts :items="readouts" />
    <PluginAnalysisPlot
      :title="mode === 'tone' ? t('pluginAnalysis.thdValue') : t('pluginAnalysis.imd')"
      x-label="Hz"
      x-unit="Hz"
      y-unit="dBFS"
      :y-label="t('pluginAnalysis.units.dbfs')"
      :series="series"
      :y-domain="[-160, 12]"
    />
    <PluginAnalysisViewControls>
      <UiSegmentedControl
        v-model="mode"
        :options="[
          { value: 'tone', label: t('pluginAnalysis.thdValue') },
          { value: 'imd', label: t('pluginAnalysis.imd') }
        ]"
        :label="t('pluginAnalysis.displayMode')"
        size="compact"
        required
      />
      <UiSegmentedControl
        v-model="channel"
        :options="channels"
        :label="t('pluginAnalysis.channel')"
        size="compact"
        required
      />
    </PluginAnalysisViewControls>
  </section>
</template>
<style scoped>
.distortion-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}
</style>
