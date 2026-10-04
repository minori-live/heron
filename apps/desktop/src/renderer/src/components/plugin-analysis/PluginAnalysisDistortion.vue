<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiSegmentedControl } from "@heron/ui"
import type { PluginAnalysisReport } from "@heron/contracts"
const props = defineProps<{ report: PluginAnalysisReport }>()
const { t } = useI18n()
const channel = ref("0")
const channels = [
  { value: "0", label: "L" },
  { value: "1", label: "R" }
]
const distortion = computed(() => props.report.distortion[Number(channel.value)] ?? null)
function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(3)}%`
}
</script>
<template>
  <section class="distortion-panel">
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
  flex: 1;
  align-content: center;
  gap: 24px;
  padding: 28px;
  background: var(--ui-color-canvas-subtle);
}
article {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--ui-color-border);
  border-radius: 6px;
  background: var(--ui-color-surface);
}
h3 {
  margin: 0 0 16px;
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
