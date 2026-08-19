<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from "vue"

import type { UiDragData } from "../types"

const props = withDefaults(
  defineProps<{
    label: string
    mimeTypes: readonly string[]
    disabled?: boolean
  }>(),
  { disabled: false }
)
const emit = defineEmits<{
  drop: [data: UiDragData[]]
}>()
const active = shallowRef(false)
const reset = (): void => {
  active.value = false
}

function accepts(event: DragEvent): boolean {
  if (props.disabled || !event.dataTransfer) return false
  return props.mimeTypes.some((mime) => event.dataTransfer?.types.includes(mime))
}

function over(event: DragEvent): void {
  if (!accepts(event)) return
  event.preventDefault()
  active.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
}

function leave(event: DragEvent): void {
  if (event.currentTarget === event.target) active.value = false
}

function finish(event: DragEvent): void {
  if (!accepts(event) || !event.dataTransfer) return
  event.preventDefault()
  active.value = false
  emit(
    "drop",
    props.mimeTypes
      .map((mime) => ({ mime, value: event.dataTransfer?.getData(mime) ?? "" }))
      .filter((entry) => entry.value.length > 0)
  )
}

onMounted(() => window.addEventListener("dragend", reset))
onUnmounted(() => window.removeEventListener("dragend", reset))
</script>

<template>
  <div
    class="ui-drop-zone"
    :class="{ 'ui-drop-zone--active': active }"
    :aria-label="props.label"
    @dragenter="over"
    @dragover="over"
    @dragleave="leave"
    @drop="finish"
  >
    <slot :active="active" />
  </div>
</template>

<style scoped>
.ui-drop-zone {
  min-width: 0;
  transition:
    border-color var(--ui-motion-fast) var(--ui-ease-standard),
    background var(--ui-motion-fast) var(--ui-ease-standard);
}

.ui-drop-zone--active {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: -2px;
  background: var(--ui-color-selection);
}
</style>
