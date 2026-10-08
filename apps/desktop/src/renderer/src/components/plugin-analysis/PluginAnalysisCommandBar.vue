<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { Activity, Settings2 } from "@lucide/vue"
import {
  UiButton,
  UiCheckbox,
  UiIconButton,
  UiProgress,
  UiSegmentedControl,
  UiSlider
} from "@heron/ui"
import type {
  PluginAnalysisCommand,
  PluginAnalysisSettings,
  PluginAnalysisSnapshot
} from "@heron/contracts"
const props = defineProps<{ snapshot: PluginAnalysisSnapshot; settingsOpen: boolean }>()
const emit = defineEmits<{
  command: [command: PluginAnalysisCommand]
  configure: [patch: Partial<PluginAnalysisSettings>]
  "toggle-settings": []
}>()
const i18n = useI18n()
const { t } = i18n
const quarantined = computed(() => props.snapshot.status === "quarantined")
const running = computed(
  () => props.snapshot.status === "running" || props.snapshot.status === "debouncing"
)
const stale = computed(
  () => !!props.snapshot.report && props.snapshot.reportRevision !== props.snapshot.revision
)
// One primary state; failures outrank staleness, which outranks a settled result.
const state = computed<{ tone: string; label: string }>(() => {
  const { status, phase, report } = props.snapshot
  if (status === "quarantined" || status === "failed")
    return { tone: "danger", label: t(`pluginAnalysis.status.${status}`) }
  if (status === "running") {
    const key = `pluginAnalysis.phases.${phase}`
    return {
      tone: "active",
      label: i18n.te(key)
        ? `${t("pluginAnalysis.status.running")} · ${t(key)}`
        : t("pluginAnalysis.status.running")
    }
  }
  if (status === "debouncing")
    return { tone: "active", label: t("pluginAnalysis.status.debouncing") }
  if (stale.value) return { tone: "warning", label: t("pluginAnalysis.stale") }
  if (status === "cancelled")
    return { tone: "neutral", label: t("pluginAnalysis.status.cancelled") }
  return report
    ? { tone: "success", label: t("pluginAnalysis.status.complete") }
    : { tone: "neutral", label: t("pluginAnalysis.status.idle") }
})
const percent = computed(() => Math.round(Math.min(1, Math.max(0, props.snapshot.progress)) * 100))
const conditions = computed(() =>
  t("pluginAnalysis.conditions", {
    rate: props.snapshot.settings.sample_rate / 1000,
    block: props.snapshot.settings.block_size,
    samples: t("pluginAnalysis.samples")
  })
)
const inputLevel = ref(-18)
watch(
  () => props.snapshot.settings.level_dbfs,
  (value) => {
    inputLevel.value = value
  },
  { immediate: true }
)
const inputLevelText = computed(
  () => `${inputLevel.value > 0 ? "+" : ""}${inputLevel.value.toFixed(1)} dBFS`
)
const channelModes = computed(() => [
  { value: "left-right", label: t("pluginAnalysis.leftRight") },
  { value: "mid-side", label: t("pluginAnalysis.midSide") }
])
</script>
<template>
  <header class="plugin-analysis-command-bar">
    <div class="run" :inert="quarantined || undefined">
      <UiButton size="sm" variant="primary" @click="emit('command', { type: 'analyze' })"
        ><Activity :size="14" aria-hidden="true" />{{ t("pluginAnalysis.analyze") }}</UiButton
      ><UiButton
        v-if="running"
        size="sm"
        variant="secondary"
        @click="emit('command', { type: 'cancel' })"
        >{{ t("pluginAnalysis.cancel") }}</UiButton
      >
      <UiCheckbox
        :model-value="snapshot.automatic"
        :label="t('pluginAnalysis.automatic')"
        @update:model-value="emit('command', { type: 'automatic', enabled: $event })"
      />
      <UiCheckbox
        :model-value="snapshot.repeating"
        :label="t('pluginAnalysis.repeat')"
        @update:model-value="emit('command', { type: 'repeat', enabled: $event })"
      />
    </div>
    <div class="status" :data-tone="state.tone">
      <span class="status-dot" aria-hidden="true" />
      <span class="status-label" role="status">{{ state.label }}</span>
      <span v-if="snapshot.status === 'running'" class="status-percent">{{ percent }}%</span>
      <span class="conditions">{{ conditions }}</span>
    </div>
    <div class="signal" :inert="quarantined || undefined">
      <div class="input-level">
        <span aria-hidden="true">{{ t("pluginAnalysis.levelShort") }}</span
        ><UiSlider
          id="plugin-analysis-input-level"
          v-model="inputLevel"
          :min="-60"
          :max="12"
          :step="0.5"
          :label="t('pluginAnalysis.level')"
          :value-text="inputLevelText"
          @change="emit('configure', { level_dbfs: inputLevel })"
        /><output for="plugin-analysis-input-level">{{ inputLevelText }}</output>
      </div>
      <UiSegmentedControl
        :model-value="snapshot.settings.mid_side ? 'mid-side' : 'left-right'"
        :options="channelModes"
        :label="t('pluginAnalysis.channelMode')"
        size="compact"
        required
        @update:model-value="emit('configure', { mid_side: $event === 'mid-side' })"
      />
    </div>
    <UiIconButton
      class="settings-toggle"
      :label="t('pluginAnalysis.measurementSettings')"
      size="sm"
      variant="ghost"
      :pressed="settingsOpen"
      :disabled="quarantined"
      aria-controls="plugin-analysis-settings"
      :aria-expanded="settingsOpen"
      @click="emit('toggle-settings')"
      ><Settings2 :size="16"
    /></UiIconButton>
    <UiProgress
      v-if="snapshot.status === 'running'"
      class="run-progress"
      :label="t('pluginAnalysis.progress')"
      :value="percent"
      :value-text="`${percent}%`"
    />
  </header>
</template>
<style scoped>
.plugin-analysis-command-bar {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 20px;
  min-height: 48px;
  padding: 8px 12px 8px 16px;
  border-bottom: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface);
  font-size: var(--ui-type-size-caption);
}
.run,
.signal {
  display: flex;
  align-items: center;
  gap: 16px;
}
.run > :deep(.ui-button) {
  gap: 6px;
}
.run > :deep(.ui-button + .ui-button) {
  margin-left: -8px;
}
.status {
  display: flex;
  align-items: center;
  flex: 1 1 200px;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
  --status-color: var(--ui-color-text-subtle);
}
.status[data-tone="active"] {
  --status-color: var(--ui-color-action);
}
.status[data-tone="success"] {
  --status-color: var(--ui-color-success);
}
.status[data-tone="warning"] {
  --status-color: var(--ui-color-warning);
}
.status[data-tone="danger"] {
  --status-color: var(--ui-color-danger);
}
.status-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-color);
}
.status-label {
  overflow: hidden;
  color: var(--ui-color-text);
  text-overflow: ellipsis;
}
.status-percent,
.conditions {
  font-family: var(--ui-type-family-data);
  font-variant-numeric: tabular-nums;
}
.status-percent {
  color: var(--ui-color-text-muted);
}
.conditions {
  padding-left: 10px;
  border-left: 1px solid var(--ui-color-border);
  color: var(--ui-color-text-subtle);
}
.input-level {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ui-color-text-muted);
}
.input-level > :deep(.ui-slider) {
  width: 140px;
}
.input-level output {
  min-width: 76px;
  color: var(--ui-color-text);
  font-family: var(--ui-type-family-data);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.settings-toggle {
  margin-left: -8px;
}
.run-progress {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 0;
  background: transparent;
}
</style>
