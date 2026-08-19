<script setup lang="ts">
import { shallowRef } from "vue"
import type { UiClipViewModel, UiDragData, UiGestureIntent, UiModifiers, UiPoint } from "../types"
import { trySetPointerCapture } from "./internal/pointerCapture"

type ClipGesture = "trim-start" | "trim-end" | "fade-in" | "fade-out"
const props = withDefaults(
  defineProps<{
    model: UiClipViewModel
    kind: "audio" | "midi"
    label: string
    openLabel?: string
    recording?: boolean
    dragging?: boolean
    editing?: boolean
    dragData?: readonly UiDragData[]
    trimStartLabel?: string
    trimEndLabel?: string
    fadeInLabel?: string
    fadeOutLabel?: string
    fadeInPercent?: number
    fadeOutPercent?: number
    fadeInValue?: number
    fadeInMaximum?: number
    fadeOutValue?: number
    fadeOutMaximum?: number
  }>(),
  {
    openLabel: undefined,
    recording: false,
    dragging: false,
    editing: false,
    dragData: () => [],
    trimStartLabel: undefined,
    trimEndLabel: undefined,
    fadeInLabel: undefined,
    fadeOutLabel: undefined,
    fadeInPercent: 0,
    fadeOutPercent: 0,
    fadeInValue: undefined,
    fadeInMaximum: undefined,
    fadeOutValue: undefined,
    fadeOutMaximum: undefined
  }
)
const emit = defineEmits<{
  select: [additive: boolean]
  open: []
  remove: []
  dragStart: [offsetPixels: number]
  dragEnd: []
  gesture: [action: ClipGesture, intent: UiGestureIntent]
}>()
const active = shallowRef<{ action: ClipGesture; origin: UiPoint }>()
const modifiers = (event: MouseEvent | KeyboardEvent): UiModifiers => ({
  alt: event.altKey,
  control: event.ctrlKey,
  meta: event.metaKey,
  shift: event.shiftKey
})
function pointerIntent(event: PointerEvent, phase: UiGestureIntent["phase"]): UiGestureIntent {
  const point = { x: event.clientX, y: event.clientY }
  const origin = active.value?.origin ?? point
  return {
    phase,
    point,
    delta: { x: point.x - origin.x, y: point.y - origin.y },
    modifiers: modifiers(event)
  }
}
function start(action: ClipGesture, event: PointerEvent): void {
  if (props.recording || props.model.disabled || event.button !== 0) return
  active.value = { action, origin: { x: event.clientX, y: event.clientY } }
  trySetPointerCapture(event.currentTarget as HTMLElement, event.pointerId)
  emit("gesture", action, pointerIntent(event, "start"))
}
function update(event: PointerEvent): void {
  if (active.value) emit("gesture", active.value.action, pointerIntent(event, "update"))
}
function finish(event: PointerEvent): void {
  if (!active.value) return
  emit("gesture", active.value.action, pointerIntent(event, "commit"))
  active.value = undefined
}
function cancel(event: PointerEvent): void {
  if (!active.value) return
  emit("gesture", active.value.action, pointerIntent(event, "cancel"))
  active.value = undefined
}
function drag(event: DragEvent): void {
  if (props.recording || props.editing || !event.dataTransfer) return event.preventDefault()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const offset = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
  event.dataTransfer.effectAllowed = "move"
  for (const item of props.dragData) event.dataTransfer.setData(item.mime, item.value)
  emit("dragStart", offset)
}
function keydown(event: KeyboardEvent): void {
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault()
    emit("remove")
  } else if (event.key === "Enter" && props.openLabel) {
    event.preventDefault()
    emit("open")
  } else if (event.key === "Escape" && active.value) {
    emit("gesture", active.value.action, {
      phase: "cancel",
      point: active.value.origin,
      delta: { x: 0, y: 0 },
      modifiers: modifiers(event)
    })
    active.value = undefined
  }
}
</script>

<template>
  <div
    class="ui-timeline-clip"
    :class="[
      `ui-timeline-clip--${props.kind}`,
      {
        'ui-timeline-clip--selected': props.model.selected,
        'ui-timeline-clip--recording': props.recording,
        'ui-timeline-clip--dragging': props.dragging,
        'ui-timeline-clip--editing': props.editing
      }
    ]"
    :style="{
      left: `${props.model.start}px`,
      width: `${Math.max(9, props.model.width)}px`,
      '--ui-clip-color': props.model.signalColor
    }"
    role="button"
    tabindex="0"
    :aria-label="props.label"
    :aria-pressed="props.model.selected"
    :draggable="!props.recording && !props.editing"
    @click="emit('select', $event.ctrlKey || $event.metaKey)"
    @dblclick="props.openLabel && emit('open')"
    @dragstart="drag"
    @dragend="emit('dragEnd')"
    @keydown="keydown"
  >
    <span
      v-if="props.trimStartLabel"
      class="ui-timeline-clip__handle ui-timeline-clip__handle--start"
      role="separator"
      :aria-label="props.trimStartLabel"
      @pointerdown="start('trim-start', $event)"
      @pointermove="update"
      @pointerup="finish"
      @pointercancel="cancel"
    />
    <span
      v-if="props.fadeInLabel"
      class="ui-timeline-clip__fade ui-timeline-clip__fade--in"
      role="slider"
      :aria-label="props.fadeInLabel"
      aria-valuemin="0"
      :aria-valuemax="props.fadeInMaximum ?? 100"
      :aria-valuenow="props.fadeInValue ?? props.fadeInPercent"
      :style="{ width: `${props.fadeInPercent}%` }"
      @pointerdown="start('fade-in', $event)"
      @pointermove="update"
      @pointerup="finish"
      @pointercancel="cancel"
    />
    <span
      v-if="props.fadeOutLabel"
      class="ui-timeline-clip__fade ui-timeline-clip__fade--out"
      role="slider"
      :aria-label="props.fadeOutLabel"
      aria-valuemin="0"
      :aria-valuemax="props.fadeOutMaximum ?? 100"
      :aria-valuenow="props.fadeOutValue ?? props.fadeOutPercent"
      :style="{ width: `${props.fadeOutPercent}%` }"
      @pointerdown="start('fade-out', $event)"
      @pointermove="update"
      @pointerup="finish"
      @pointercancel="cancel"
    />
    <slot name="overlay" />
    <div class="ui-timeline-clip__heading">
      <slot name="heading">{{ props.model.label }}</slot>
    </div>
    <slot />
    <span
      v-if="props.trimEndLabel"
      class="ui-timeline-clip__handle ui-timeline-clip__handle--end"
      role="separator"
      :aria-label="props.trimEndLabel"
      @pointerdown="start('trim-end', $event)"
      @pointermove="update"
      @pointerup="finish"
      @pointercancel="cancel"
    />
  </div>
</template>

<style scoped>
.ui-timeline-clip {
  position: absolute;
  top: 5px;
  bottom: 5px;
  overflow: hidden;
  min-width: 9px;
  border: 1px solid var(--ui-clip-color, var(--ui-color-action));
  border-radius: var(--ui-radius-sm);
  color: var(--ui-color-text);
  background: color-mix(
    in srgb,
    var(--ui-clip-color, var(--ui-color-action)) 24%,
    var(--ui-color-surface)
  );
  cursor: grab;
  user-select: none;
}
.ui-timeline-clip:hover {
  filter: brightness(1.08);
}
.ui-timeline-clip:focus-visible,
.ui-timeline-clip--selected {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: -2px;
}
.ui-timeline-clip--dragging {
  opacity: 0.25;
  cursor: grabbing;
}
.ui-timeline-clip--editing {
  cursor: ew-resize;
}
.ui-timeline-clip--recording {
  --ui-clip-color: var(--ui-color-danger);
}
.ui-timeline-clip__heading {
  position: relative;
  z-index: var(--ui-z-local-raised);
  overflow: hidden;
  padding: var(--ui-space-1) var(--ui-space-2);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}
.ui-timeline-clip__handle {
  position: absolute;
  z-index: var(--ui-z-local-handle);
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
  touch-action: none;
}
.ui-timeline-clip__handle--start {
  left: 0;
}
.ui-timeline-clip__handle--end {
  right: 0;
}
.ui-timeline-clip__fade {
  position: absolute;
  z-index: var(--ui-z-local-sticky);
  top: 0;
  height: 10px;
  min-width: 8px;
  cursor: ew-resize;
  touch-action: none;
}
.ui-timeline-clip__fade--in {
  left: 0;
}
.ui-timeline-clip__fade--out {
  right: 0;
}
</style>
