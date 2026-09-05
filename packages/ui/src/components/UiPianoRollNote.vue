<script setup lang="ts">
import { shallowRef } from "vue"
import type { UiGestureIntent, UiModifiers, UiPianoRollNoteViewModel, UiPoint } from "../types"
import { trySetPointerCapture } from "./internal/pointerCapture"
type Mode = "move" | "resize-left" | "resize-right"
const props = defineProps<{ model: UiPianoRollNoteViewModel }>()
const emit = defineEmits<{
  gesture: [mode: Mode, intent: UiGestureIntent]
  select: [modifiers: UiModifiers]
  hover: []
}>()
const active = shallowRef<{ mode: Mode; origin: UiPoint; pointerId: number }>()
const modifiers = (event: MouseEvent | KeyboardEvent): UiModifiers => ({
  alt: event.altKey,
  control: event.ctrlKey,
  meta: event.metaKey,
  shift: event.shiftKey
})
function point(event: PointerEvent): UiPoint {
  const grid = (event.currentTarget as HTMLElement).closest<HTMLElement>(".ui-piano-roll-grid")
  const b = grid?.getBoundingClientRect()
  return { x: event.clientX - (b?.left ?? 0), y: event.clientY - (b?.top ?? 0) }
}
function intent(event: PointerEvent, phase: UiGestureIntent["phase"]): UiGestureIntent {
  const p = point(event),
    o = active.value?.origin ?? p
  return { phase, point: p, delta: { x: p.x - o.x, y: p.y - o.y }, modifiers: modifiers(event) }
}
function start(mode: Mode, event: PointerEvent): void {
  if (event.button !== 0 || active.value) return
  event.preventDefault()
  event.stopPropagation()
  ;(event.currentTarget as HTMLElement)
    .closest<HTMLElement>(".ui-piano-roll-note")
    ?.focus({ preventScroll: true })
  const p = point(event)
  active.value = { mode, origin: p, pointerId: event.pointerId }
  trySetPointerCapture(event.currentTarget as HTMLElement, event.pointerId)
  emit("gesture", mode, intent(event, "start"))
}
function update(event: PointerEvent): void {
  if (active.value?.pointerId === event.pointerId)
    emit("gesture", active.value.mode, intent(event, "update"))
}
function finish(event: PointerEvent): void {
  if (active.value?.pointerId === event.pointerId) {
    emit("gesture", active.value.mode, intent(event, "commit"))
    active.value = undefined
  }
}
function cancel(event: PointerEvent): void {
  if (active.value?.pointerId === event.pointerId) {
    emit("gesture", active.value.mode, intent(event, "cancel"))
    active.value = undefined
  }
}
function escape(event: KeyboardEvent): void {
  if (!active.value) return
  event.preventDefault()
  event.stopPropagation()
  emit("gesture", active.value.mode, {
    phase: "cancel",
    point: active.value.origin,
    delta: { x: 0, y: 0 },
    modifiers: modifiers(event)
  })
  active.value = undefined
}
</script>
<template>
  <div
    class="ui-piano-roll-note"
    :class="{
      'ui-piano-roll-note--selected': props.model.selected,
      'ui-piano-roll-note--inactive': props.model.inactive,
      'ui-piano-roll-note--previewing': props.model.previewing,
      'ui-piano-roll-note--erasing': props.model.erasing
    }"
    role="button"
    tabindex="0"
    :aria-label="props.model.label"
    :aria-pressed="props.model.selected"
    @click="emit('select', modifiers($event))"
    @pointerdown="start('move', $event)"
    @pointermove="update"
    @pointerup="finish"
    @pointercancel="cancel"
    @lostpointercapture="cancel"
    @keydown.esc="escape"
    @pointerover="emit('hover')"
  >
    <span
      class="ui-piano-roll-note__handle ui-piano-roll-note__handle--left"
      @pointerdown.stop="start('resize-left', $event)"
      @pointermove.stop="update"
      @pointerup.stop="finish"
      @pointercancel.stop="cancel"
      @lostpointercapture.stop="cancel"
    />
    <span class="ui-piano-roll-note__label"
      ><slot>{{ props.model.label }}</slot></span
    >
    <span
      class="ui-piano-roll-note__handle ui-piano-roll-note__handle--right"
      @pointerdown.stop="start('resize-right', $event)"
      @pointermove.stop="update"
      @pointerup.stop="finish"
      @pointercancel.stop="cancel"
      @lostpointercapture.stop="cancel"
    />
  </div>
</template>
<style scoped>
.ui-piano-roll-note {
  position: absolute;
  z-index: var(--ui-z-local-raised);
  display: flex;
  min-width: 2px;
  align-items: center;
  overflow: hidden;
  padding: 0 var(--ui-space-1);
  border: 1px solid
    color-mix(in srgb, var(--note-color, var(--ui-color-action)) 65%, var(--ui-color-border-strong));
  border-radius: var(--ui-radius-sm);
  color: var(--ui-color-canvas);
  background: var(--note-color, var(--ui-color-action));
  cursor: grab;
  touch-action: none;
}
.ui-piano-roll-note--inactive {
  opacity: 0.58;
}
.ui-piano-roll-note--selected,
.ui-piano-roll-note:focus-visible {
  z-index: var(--ui-z-local-selection);
  outline: 2px solid var(--ui-color-focus);
  opacity: 1;
}
.ui-piano-roll-note--previewing {
  cursor: grabbing;
}
.ui-piano-roll-note--erasing {
  opacity: 0.25;
  pointer-events: none;
}
.ui-piano-roll-note__label {
  overflow: hidden;
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  white-space: nowrap;
  pointer-events: none;
}
.ui-piano-roll-note__handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 5px;
  cursor: ew-resize;
}
.ui-piano-roll-note__handle--left {
  left: 0;
}
.ui-piano-roll-note__handle--right {
  right: 0;
}
</style>
