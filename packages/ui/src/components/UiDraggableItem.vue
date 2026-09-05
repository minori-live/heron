<script setup lang="ts">
import type { UiDragData, UiDragEffect } from "../types"

const props = withDefaults(
  defineProps<{
    data: readonly UiDragData[]
    disabled?: boolean
    effectAllowed?: UiDragEffect
    label?: string
  }>(),
  {
    disabled: false,
    effectAllowed: "copyMove",
    label: undefined
  }
)
const emit = defineEmits<{
  dragStart: []
  dragEnd: []
  reorder: [direction: -1 | 1]
}>()

function keydown(event: KeyboardEvent): void {
  if (props.disabled || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
    return
  event.preventDefault()
  emit("reorder", event.key === "ArrowUp" ? -1 : 1)
}

function start(event: DragEvent): void {
  if (props.disabled || !event.dataTransfer) {
    event.preventDefault()
    return
  }
  event.dataTransfer.effectAllowed = props.effectAllowed
  for (const entry of props.data) event.dataTransfer.setData(entry.mime, entry.value)
  emit("dragStart")
}
</script>

<template>
  <div
    class="ui-draggable-item"
    :class="{ 'ui-draggable-item--disabled': props.disabled }"
    :draggable="!props.disabled"
    :aria-label="props.label"
    :tabindex="props.label && !props.disabled ? 0 : undefined"
    @keydown="keydown"
    @dragstart="start"
    @dragend="emit('dragEnd')"
  >
    <slot />
  </div>
</template>

<style scoped>
.ui-draggable-item:not(.ui-draggable-item--disabled) {
  cursor: grab;
}

.ui-draggable-item:not(.ui-draggable-item--disabled):active {
  cursor: grabbing;
}
</style>
