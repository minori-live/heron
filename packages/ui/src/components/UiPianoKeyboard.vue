<script setup lang="ts">
import type { UiPianoKey } from "../types"
const props = defineProps<{ keys: readonly UiPianoKey[]; rowHeight: number; label: string }>()
const emit = defineEmits<{ select: [key: number] }>()
</script>
<template>
  <div
    class="ui-piano-keyboard"
    :style="{ height: `${props.rowHeight * props.keys.length}px` }"
    role="group"
    :aria-label="props.label"
  >
    <button
      v-for="item in props.keys"
      :key="item.key"
      type="button"
      class="ui-piano-keyboard__key"
      :class="{ 'ui-piano-keyboard__key--black': item.black }"
      :style="{
        top: `${(props.keys.length - 1 - item.key) * props.rowHeight}px`,
        height: `${props.rowHeight}px`
      }"
      :aria-label="item.label"
      @click="emit('select', item.key)"
    >
      {{ item.key % 12 === 0 ? item.label : "" }}
    </button>
  </div>
</template>
<style scoped>
.ui-piano-keyboard {
  position: sticky;
  z-index: var(--ui-z-local-sticky);
  left: 0;
  width: 72px;
  border-right: 1px solid var(--ui-color-border-strong);
  background: var(--ui-color-surface);
}
.ui-piano-keyboard__key {
  position: absolute;
  left: 0;
  width: 72px;
  padding: 0 var(--ui-space-2);
  border: 0;
  border-bottom: 1px solid var(--ui-color-border);
  color: var(--ui-color-text-muted);
  background: var(--ui-color-surface);
  text-align: right;
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  cursor: pointer;
}
.ui-piano-keyboard__key--black {
  width: 47px;
  border-right: 1px solid var(--ui-color-border-strong);
  color: var(--ui-color-text);
  background: var(--ui-color-canvas-subtle);
}
.ui-piano-keyboard__key:hover,
.ui-piano-keyboard__key:focus-visible {
  color: var(--ui-color-text);
  background: var(--ui-color-surface-hover);
}
</style>
