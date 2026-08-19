<script setup lang="ts">
import type { UiGestureIntent } from "../types"
import UiGestureSurface from "./internal/UiGestureSurface.vue"

const props = withDefaults(
  defineProps<{
    label: string
    trackId?: string
    trackKind?: string
    selected?: boolean
    focusable?: boolean
    keyboardPosition?: number
  }>(),
  {
    trackId: undefined,
    trackKind: undefined,
    selected: false,
    focusable: false,
    keyboardPosition: 0
  }
)
const emit = defineEmits<{
  select: []
  gesture: [intent: UiGestureIntent]
  create: [position: number]
  reorder: [direction: -1 | 1]
}>()

function gesture(intent: UiGestureIntent): void {
  if (intent.phase === "start") emit("select")
  emit("gesture", intent)
}
</script>

<template>
  <UiGestureSurface
    class="ui-arrangement-track-surface"
    :class="{ 'ui-arrangement-track-surface--selected': props.selected }"
    :label="props.label"
    :tabindex="props.focusable ? 0 : undefined"
    :data-track-id="props.trackId"
    :data-track-kind="props.trackKind"
    @gesture="gesture"
    @double-activate="emit('create', $event.x)"
    @activate="emit('create', props.keyboardPosition)"
    @reorder="emit('reorder', $event)"
  >
    <slot />
  </UiGestureSurface>
</template>

<style scoped>
.ui-arrangement-track-surface {
  position: relative;
  min-width: 0;
}
.ui-arrangement-track-surface:focus-visible {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: -2px;
}
.ui-arrangement-track-surface--selected {
  background: var(--ui-color-selection);
}
</style>
