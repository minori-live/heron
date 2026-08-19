<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui"

import type { UiNavigationItem } from "../types"

const model = defineModel<string>({ required: true })
const props = defineProps<{
  label: string
  items: readonly UiNavigationItem[]
}>()
</script>

<template>
  <TabsRoot v-model="model" class="ui-tabs">
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
    <TabsContent v-for="item in props.items" :key="item.id" :value="item.id" as-child>
      <slot :name="item.id" :item="item" />
    </TabsContent>
  </TabsRoot>
</template>

<style scoped>
.ui-tabs {
  min-width: 0;
}

.ui-tabs__list {
  display: flex;
  min-width: 0;
  gap: var(--ui-space-1);
  border-bottom: 1px solid var(--ui-color-border);
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
</style>
