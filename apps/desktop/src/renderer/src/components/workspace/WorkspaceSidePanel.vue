<script setup lang="ts">
import { computed, shallowRef } from "vue"
import { UiResizeHandle, type UiGestureIntent } from "@heron/ui"

const requestedWidth = defineModel<number>({ required: true })
const props = defineProps<{
  label: string
  resizeLabel: string
  minimum: number
  maximum: number
  defaultWidth: number
}>()

function clampWidth(value: number): number {
  return Math.max(props.minimum, Math.min(props.maximum, value))
}

// A responsive limit affects the visible width, not the document's saved preference.
const width = computed(() => clampWidth(requestedWidth.value))
const gestureStartWidth = shallowRef(width.value)
const gestureStartPreference = shallowRef(requestedWidth.value)
const resizing = shallowRef(false)

function resize(intent: UiGestureIntent): void {
  if (intent.phase === "start") {
    gestureStartWidth.value = width.value
    gestureStartPreference.value = requestedWidth.value
    resizing.value = true
  } else if (intent.phase === "update") {
    requestedWidth.value = clampWidth(gestureStartWidth.value - intent.delta.x)
  } else if (intent.phase === "commit") {
    requestedWidth.value = clampWidth(
      (resizing.value ? gestureStartWidth.value : width.value) - intent.delta.x
    )
    resizing.value = false
  } else {
    requestedWidth.value = gestureStartPreference.value
    resizing.value = false
  }
}
</script>

<template>
  <aside class="workspace-side-panel" :style="{ width: `${width}px` }" :aria-label="label">
    <UiResizeHandle
      class="workspace-side-panel-resizer"
      axis="horizontal"
      :label="resizeLabel"
      :keyboard-step="10"
      :value="width"
      :minimum="minimum"
      :maximum="maximum"
      reset-on-double-click
      @gesture="resize"
      @reset="requestedWidth = clampWidth(defaultWidth)"
    />
    <slot />
  </aside>
</template>

<style scoped>
.workspace-side-panel {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--ui-color-border-strong);
}
.workspace-side-panel-resizer {
  position: absolute;
  z-index: var(--ui-z-local-controls);
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
}
</style>
