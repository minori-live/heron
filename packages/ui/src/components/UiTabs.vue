<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui"

import type { UiNavigationItem } from "../types"

const model = defineModel<string>({ required: true })
const props = defineProps<{
  label: string
  items: readonly UiNavigationItem[]
  appearance?: "default" | "analysis"
}>()
</script>

<template>
  <TabsRoot v-model="model" class="ui-tabs" :data-appearance="props.appearance">
    <div class="ui-tabs__bar">
      <TabsList class="ui-tabs__list" :aria-label="props.label">
        <TabsTrigger
          v-for="item in props.items"
          :key="item.id"
          class="ui-tabs__trigger"
          :value="item.id"
          :disabled="item.disabled"
        >
          {{ item.label }}
          <span v-if="item.badge" class="ui-tabs__badge">{{ item.badge }}</span>
        </TabsTrigger>
      </TabsList>
      <div v-if="$slots['list-end']" class="ui-tabs__end"><slot name="list-end" /></div>
    </div>
    <TabsContent v-for="item in props.items" :key="item.id" :value="item.id" as-child>
      <slot :name="item.id" :item="item" />
    </TabsContent>
  </TabsRoot>
</template>

<style scoped>
.ui-tabs {
  min-width: 0;
}

.ui-tabs__bar {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--ui-space-3);
  border-bottom: 1px solid var(--ui-color-border);
}

.ui-tabs__list {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  gap: var(--ui-space-1);
}

.ui-tabs__end {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ui-space-2);
}

.ui-tabs__trigger {
  min-height: var(--ui-control-sm);
  padding: 0 var(--ui-space-3);
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--ui-color-text-muted);
  background: transparent;
  font: var(--ui-type-weight-medium) var(--ui-type-size-control) var(--ui-type-family-interface);
  cursor: pointer;
}

.ui-tabs__trigger:hover:not(:disabled) {
  color: var(--ui-color-text);
  background: var(--ui-color-surface-hover);
}

.ui-tabs__trigger[data-state="active"] {
  border-bottom-color: var(--ui-color-action);
  color: var(--ui-color-text);
}

.ui-tabs__trigger:disabled {
  cursor: not-allowed;
  opacity: var(--ui-opacity-disabled);
}

.ui-tabs__badge {
  margin-inline-start: var(--ui-space-1);
  color: var(--ui-color-text-subtle);
}
/* Instrument views: a quiet sunken bar whose selected view is marked by the
   focus/action rail, leaving saturated colour to the plotted signals. */
.ui-tabs[data-appearance="analysis"] .ui-tabs__bar {
  flex-wrap: wrap;
  column-gap: var(--ui-space-3);
  padding: 0 var(--ui-space-3);
  background: var(--ui-color-surface-sunken);
}
.ui-tabs[data-appearance="analysis"] .ui-tabs__end {
  margin-inline-start: auto;
  padding-block: var(--ui-space-1);
}
.ui-tabs[data-appearance="analysis"] .ui-tabs__list {
  gap: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.ui-tabs[data-appearance="analysis"] .ui-tabs__trigger {
  flex: none;
  min-height: var(--ui-control-md);
  padding-inline: var(--ui-space-3);
  border-bottom-width: 2px;
  margin-bottom: -1px;
}
.ui-tabs[data-appearance="analysis"] .ui-tabs__trigger:hover:not(:disabled) {
  background: transparent;
}
.ui-tabs[data-appearance="analysis"] .ui-tabs__trigger[data-state="active"] {
  border-bottom-color: var(--ui-color-action);
  color: var(--ui-color-text);
}
.ui-tabs[data-appearance="analysis"] .ui-tabs__trigger:focus-visible {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: -2px;
}
</style>
