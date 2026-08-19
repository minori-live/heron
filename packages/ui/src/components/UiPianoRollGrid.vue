<script setup lang="ts">
import { shallowRef } from "vue"
import type { UiGestureIntent, UiModifiers, UiPoint } from "../types"
import { trySetPointerCapture } from "./internal/pointerCapture"
const props = defineProps<{ label: string }>()
const emit = defineEmits<{ gesture: [intent: UiGestureIntent] }>()
const active = shallowRef(false)
function modifiers(event: PointerEvent): UiModifiers {
  return { alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey }
}
function point(event: PointerEvent): UiPoint {
  const b = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: event.clientX - b.left, y: event.clientY - b.top }
}
function send(event: PointerEvent, phase: UiGestureIntent["phase"]): void {
  const current = point(event)
  emit("gesture", { phase, point: current, delta: { x: 0, y: 0 }, modifiers: modifiers(event) })
}
function start(event: PointerEvent): void {
  if (event.target !== event.currentTarget) return
  active.value = true
  trySetPointerCapture(event.currentTarget as HTMLElement, event.pointerId)
  send(event, "start")
}
function update(event: PointerEvent): void {
  if (active.value) send(event, "update")
}
function finish(event: PointerEvent): void {
  if (active.value) {
    send(event, "commit")
    active.value = false
  }
}
function cancel(event: PointerEvent): void {
  if (active.value) {
    send(event, "cancel")
    active.value = false
  }
}
</script>
<template>
  <div
    class="ui-piano-roll-grid"
    role="application"
    tabindex="0"
    :aria-label="props.label"
    @pointerdown="start"
    @pointermove="update"
    @pointerup="finish"
    @pointercancel="cancel"
  >
    <slot />
  </div>
</template>
<style scoped>
.ui-piano-roll-grid {
  position: absolute;
  isolation: isolate;
  overflow: hidden;
  background: var(--ui-color-canvas-subtle);
  touch-action: none;
}
.ui-piano-roll-grid:focus-visible {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: -2px;
}
</style>
