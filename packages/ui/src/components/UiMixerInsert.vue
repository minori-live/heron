<script setup lang="ts">
import { shallowRef } from "vue"

const props = defineProps<{
  label: string
}>()
const hovered = shallowRef(false)

defineSlots<{
  leading(): unknown
  default(): unknown
  actions(): unknown
}>()
</script>

<template>
  <article
    class="ui-mixer-insert"
    :class="{ 'is-hovered': hovered }"
    :aria-label="props.label"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
  >
    <span class="ui-mixer-insert__content"><slot /></span>
    <span v-if="$slots.leading" class="ui-mixer-insert__leading"><slot name="leading" /></span>
    <span v-if="$slots.actions" class="ui-mixer-insert__actions"><slot name="actions" /></span>
  </article>
</template>

<style scoped>
.ui-mixer-insert {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  isolation: isolate;
}

.ui-mixer-insert__content {
  z-index: var(--ui-z-local-content);
  display: grid;
  min-width: 0;
  grid-area: 1 / 2;
  height: 100%;
  overflow: hidden;
}

.ui-mixer-insert__content :deep(.ui-button) {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  font-weight: var(--ui-type-weight-regular);
}

.ui-mixer-insert__content :deep(.ui-button__content) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-mixer-insert__leading,
.ui-mixer-insert__actions {
  z-index: var(--ui-z-local-raised);
  display: flex;
  align-items: center;
  height: 100%;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--ui-motion-fast) var(--ui-ease-standard);
}

.ui-mixer-insert__leading {
  grid-area: 1 / 1;
  justify-self: start;
}

.ui-mixer-insert__actions {
  grid-area: 1 / 3;
  justify-self: end;
}

.ui-mixer-insert.is-hovered .ui-mixer-insert__leading,
.ui-mixer-insert.is-hovered .ui-mixer-insert__actions,
.ui-mixer-insert:focus-within .ui-mixer-insert__leading,
.ui-mixer-insert:focus-within .ui-mixer-insert__actions {
  opacity: 1;
  max-width: none;
  pointer-events: auto;
}
</style>
