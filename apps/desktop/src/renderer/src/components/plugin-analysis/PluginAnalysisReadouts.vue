<script setup lang="ts">
import { UiProgress } from "@heron/ui"
interface PluginAnalysisReadout {
  label: string
  value: string
  unit?: string
  detail?: string
  /** Percent of a budget, drawn as a meter under the value. */
  meter?: number
  tone?: "warning"
  /** Spans two columns for compound values such as percentile triples. */
  wide?: boolean
}
defineProps<{ items: readonly PluginAnalysisReadout[] }>()
</script>
<template>
  <dl class="plugin-analysis-readouts">
    <div
      v-for="item in items"
      :key="item.label"
      class="readout"
      :class="{ wide: item.wide }"
      :data-tone="item.tone"
    >
      <dt>{{ item.label }}</dt>
      <dd class="reading">
        <span class="value">{{ item.value }}</span>
        <span v-if="item.unit" class="unit">&nbsp;{{ item.unit }}</span>
      </dd>
      <dd v-if="item.meter !== undefined" class="meter">
        <UiProgress :label="item.label" :value="item.meter" />
      </dd>
      <dd v-if="item.detail" class="detail">{{ item.detail }}</dd>
    </div>
  </dl>
</template>
<style scoped>
.plugin-analysis-readouts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  flex: none;
  margin: 0;
  border-bottom: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface);
}
.readout.wide {
  grid-column: span 2;
}
.readout {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 16px 12px;
  border-right: 1px solid var(--ui-color-border);
}
dt {
  overflow: hidden;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}
dd {
  margin: 0;
}
.reading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  font-family: var(--ui-type-family-data);
  font-variant-numeric: tabular-nums;
}
.value {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--ui-color-text);
  font-size: var(--ui-type-size-feature-title);
}
.readout[data-tone="warning"] .value {
  color: var(--ui-color-warning);
}
.unit {
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-label);
}
.meter > :deep(.ui-progress) {
  height: 4px;
}
.detail {
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-caption);
  font-family: var(--ui-type-family-data);
}
</style>
