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
  min-width: 0;
  isolation: isolate;
}

.ui-mixer-insert__content {
  z-index: var(--ui-z-local-content);
  display: grid;
  min-width: 0;
  grid-area: 1 / 1;
}

.ui-mixer-insert__leading,
.ui-mixer-insert__actions {
  z-index: var(--ui-z-local-raised);
  display: flex;
  grid-area: 1 / 1;
  align-items: center;
  height: 100%;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--ui-motion-fast) var(--ui-ease-standard);
}

.ui-mixer-insert__leading {
  justify-self: start;
}

.ui-mixer-insert__actions {
  justify-self: end;
}

.ui-mixer-insert.is-hovered .ui-mixer-insert__leading,
.ui-mixer-insert.is-hovered .ui-mixer-insert__actions,
.ui-mixer-insert:focus-within .ui-mixer-insert__leading,
.ui-mixer-insert:focus-within .ui-mixer-insert__actions {
  opacity: 1;
  pointer-events: auto;
}
</style>
