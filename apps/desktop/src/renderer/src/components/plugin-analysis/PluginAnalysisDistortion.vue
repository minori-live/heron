<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiSegmentedControl } from "@heron/ui"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
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
        color: index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)"
      }
    ]
  })
)
function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(3)}%`
}
</script>
<template>
  <section class="distortion-panel">
    <PluginAnalysisPlot
      :title="mode === 'tone' ? t('pluginAnalysis.thdValue') : t('pluginAnalysis.imd')"
      x-label="Hz"
      x-unit="Hz"
      y-unit="dBFS"
      :y-label="t('pluginAnalysis.units.dbfs')"
      :series="series"
      :y-domain="[-160, 12]"
    />
    <div class="metrics">
      <article>
        <h3>{{ t("pluginAnalysis.thdValue") }}</h3>
        <strong>{{ percent(distortion?.thd_percent) }}</strong>
        <p>{{ distortion ? `${distortion.tone_hz.toFixed(1)} Hz` : "" }}</p>
      </article>
      <article>
        <h3>{{ t("pluginAnalysis.thdPlusNoise") }}</h3>
        <strong>{{ percent(distortion?.thd_plus_n_percent) }}</strong>
      </article>
      <article>
        <h3>{{ t("pluginAnalysis.imd") }}</h3>
        <strong>{{ percent(distortion?.imd_percent) }}</strong>
        <p>{{ t("pluginAnalysis.imdTones") }}</p>
      </article>
    </div>
    <footer class="toolbar">
      <UiSegmentedControl
        v-model="mode"
        :options="[
          { value: 'tone', label: t('pluginAnalysis.thdValue') },
          { value: 'imd', label: t('pluginAnalysis.imd') }
        ]"
        :label="t('pluginAnalysis.displayMode')"
        required
      />
      <UiSegmentedControl
        v-model="channel"
        :options="channels"
        :label="t('pluginAnalysis.channel')"
        size="compact"
        required
      />
    </footer>
  </section>
</template>
<style scoped>
.distortion-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-content: center;
  gap: 24px;
  padding: 8px 16px;
  background: var(--ui-color-canvas-subtle);
}
article {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--ui-color-border);
  border-radius: 6px;
  background: var(--ui-color-surface);
}
h3 {
  margin: 0 0 4px;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
  font-weight: var(--ui-type-weight-regular);
}
strong {
  font: var(--ui-type-size-page-title) var(--ui-type-family-data);
  color: var(--ui-signal-mixer-input);
}
article p {
  margin: 10px 0 0;
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-caption);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-sunken);
}
</style>
