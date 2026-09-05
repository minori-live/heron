<script setup lang="ts">
import { shallowRef } from "vue"
import type { UiGestureIntent, UiModifiers, UiPoint } from "../types"
import { trySetPointerCapture } from "./internal/pointerCapture"
const props = defineProps<{ label: string }>()
const emit = defineEmits<{ gesture: [intent: UiGestureIntent] }>()
const active = shallowRef<number | null>(null)
let lastIntent: UiGestureIntent | undefined
function modifiers(event: PointerEvent): UiModifiers {
  return { alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey }
}
function point(event: PointerEvent): UiPoint {
  const b = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: event.clientX - b.left, y: event.clientY - b.top }
}
function send(event: PointerEvent, phase: UiGestureIntent["phase"]): void {
  const current = point(event)
  lastIntent = { phase, point: current, delta: { x: 0, y: 0 }, modifiers: modifiers(event) }
  emit("gesture", lastIntent)
}
function start(event: PointerEvent): void {
  if (event.target !== event.currentTarget || event.button !== 0 || active.value !== null) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
  active.value = event.pointerId
  trySetPointerCapture(event.currentTarget as HTMLElement, event.pointerId)
  send(event, "start")
}
function update(event: PointerEvent): void {
  if (active.value === event.pointerId) send(event, "update")
}
function finish(event: PointerEvent): void {
  if (active.value === event.pointerId) {
    send(event, "commit")
    active.value = null
  }
}
function cancel(event: PointerEvent): void {
  if (active.value === event.pointerId) {
    send(event, "cancel")
    active.value = null
  }
}
function escape(event: KeyboardEvent): void {
  if (active.value === null || !lastIntent) return
  event.preventDefault()
  event.stopPropagation()
  active.value = null
  emit("gesture", { ...lastIntent, phase: "cancel" })
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
    @lostpointercapture="cancel"
    @keydown.esc="escape"
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
