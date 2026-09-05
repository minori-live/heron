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
const active = shallowRef<{ action: ClipGesture; origin: UiPoint; pointerId: number }>()
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
  if (props.recording || props.model.disabled || event.button !== 0 || active.value) return
  event.preventDefault()
  event.stopPropagation()
  ;(event.currentTarget as HTMLElement)
    .closest<HTMLElement>(".ui-timeline-clip")
    ?.focus({ preventScroll: true })
  active.value = {
    action,
    origin: { x: event.clientX, y: event.clientY },
    pointerId: event.pointerId
  }
  trySetPointerCapture(event.currentTarget as HTMLElement, event.pointerId)
  emit("gesture", action, pointerIntent(event, "start"))
}
function update(event: PointerEvent): void {
  if (active.value?.pointerId !== event.pointerId) return
  event.preventDefault()
  event.stopPropagation()
  emit("gesture", active.value.action, pointerIntent(event, "update"))
}
function finish(event: PointerEvent): void {
  if (active.value?.pointerId !== event.pointerId) return
  event.preventDefault()
  event.stopPropagation()
  emit("gesture", active.value.action, pointerIntent(event, "commit"))
  active.value = undefined
}
function cancel(event: PointerEvent): void {
  if (active.value?.pointerId !== event.pointerId) return
  event.stopPropagation()
  emit("gesture", active.value.action, pointerIntent(event, "cancel"))
  active.value = undefined
}
function drag(event: DragEvent): void {
  if (
    props.recording ||
    props.model.disabled ||
    props.editing ||
    active.value ||
    !event.dataTransfer
  )
    return event.preventDefault()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const offset = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
  event.dataTransfer.effectAllowed = "move"
  const dragImage = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
    ".ui-timeline-clip__drag-image"
  )
  if (dragImage) event.dataTransfer.setDragImage?.(dragImage, 0, 0)
  for (const item of props.dragData) event.dataTransfer.setData(item.mime, item.value)
  emit("dragStart", offset)
}
function keydown(event: KeyboardEvent): void {
  if (props.model.disabled || props.recording) return
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault()
    emit("remove")
  } else if (event.key === "Enter" && props.openLabel) {
    event.preventDefault()
    emit("open")
  } else if (event.key === "Escape" && active.value) {
    event.preventDefault()
    event.stopPropagation()
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
    :aria-disabled="props.model.disabled || undefined"
    :draggable="!props.recording && !props.editing && !props.model.disabled"
    @pointerdown.stop
    @click.stop="!props.model.disabled && emit('select', $event.ctrlKey || $event.metaKey)"
    @dblclick.stop="!props.model.disabled && props.openLabel && emit('open')"
    @dragstart.stop="drag"
    @dragend="emit('dragEnd')"
    @keydown="keydown"
  >
    <span class="ui-timeline-clip__drag-image" aria-hidden="true" />
    <span
      v-if="props.trimStartLabel"
      class="ui-timeline-clip__handle ui-timeline-clip__handle--start"
      role="separator"
      aria-orientation="vertical"
      :aria-label="props.trimStartLabel"
      @pointerdown="start('trim-start', $event)"
      @pointermove="update"
      @pointerup="finish"
      @pointercancel="cancel"
      @lostpointercapture="cancel"
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
      @lostpointercapture="cancel"
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
      @lostpointercapture="cancel"
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
      aria-orientation="vertical"
      :aria-label="props.trimEndLabel"
      @pointerdown="start('trim-end', $event)"
      @pointermove="update"
      @pointerup="finish"
      @pointercancel="cancel"
      @lostpointercapture="cancel"
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
  z-index: var(--ui-z-local-selection);
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
  z-index: calc(var(--ui-z-local-selection) + 2);
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
  z-index: calc(var(--ui-z-local-selection) + 3);
  top: 0;
  height: 10px;
  min-width: 8px;
  max-width: 100%;
  cursor: ew-resize;
  touch-action: none;
}
.ui-timeline-clip__fade--in {
  left: 0;
}
.ui-timeline-clip__fade--out {
  right: 0;
}

.ui-timeline-clip__fade::after {
  position: absolute;
  top: 2px;
  width: 6px;
  height: 6px;
  border: 1px solid var(--ui-domain-color-fff);
  border-radius: 50%;
  background: var(--ui-clip-color);
  content: "";
}
.ui-timeline-clip__fade--in::after {
  right: -3px;
}
.ui-timeline-clip__fade--out::after {
  left: -3px;
}
.ui-timeline-clip__drag-image {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.ui-timeline-clip--audio .ui-timeline-clip__heading {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 23px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px 5px;
  color: var(--ui-domain-color-f7f8f8);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-clip-color) 34%, var(--ui-domain-color-111111e8)) 0%,
    color-mix(in srgb, var(--ui-clip-color) 24%, var(--ui-domain-color-111111b8)) 72%,
    transparent 100%
  );
  z-index: var(--ui-z-local-selection);
}
.ui-timeline-clip--audio {
  z-index: var(--ui-z-local-raised);
  top: 9px;
  bottom: 9px;
  min-width: 12px;
  border: 1px solid color-mix(in srgb, var(--ui-clip-color) 72%, white);
  border-radius: 4px;
  color: var(--ui-domain-color-f7f8f8);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-clip-color) 65%, var(--ui-domain-color-303436)),
    color-mix(in srgb, var(--ui-clip-color) 38%, var(--ui-domain-color-17191a))
  );
  box-shadow:
    0 1px 0 var(--ui-domain-color-ffffff24) inset,
    0 7px 18px var(--shadow);
  text-align: left;
}
.ui-timeline-clip--audio:hover {
  border-color: color-mix(in srgb, var(--ui-clip-color) 55%, white);
}
.ui-timeline-clip--audio.ui-timeline-clip--dragging {
  opacity: 0.2;
}
.ui-timeline-clip--audio.ui-timeline-clip--recording .ui-timeline-clip__heading {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-signal-record) 34%, var(--ui-domain-color-111111e8)) 0%,
    color-mix(in srgb, var(--ui-signal-record) 24%, var(--ui-domain-color-111111b8)) 72%,
    transparent 100%
  );
}
.ui-timeline-clip--audio.ui-timeline-clip--selected {
  z-index: var(--ui-z-local-selection);
  border-color: var(--ui-domain-color-fff);
  outline: none;
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--ui-clip-color) 60%, transparent) inset,
    0 0 20px color-mix(in srgb, var(--ui-clip-color) 45%, transparent);
}
.ui-timeline-clip--audio.ui-timeline-clip--recording {
  border-color: color-mix(in srgb, var(--ui-signal-record) 72%, white);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-signal-record) 72%, var(--ui-domain-color-303436)),
    color-mix(in srgb, var(--ui-signal-record) 42%, var(--ui-domain-color-17191a))
  );
  box-shadow: 0 0 18px color-mix(in srgb, var(--ui-signal-record) 35%, transparent);
}
.ui-timeline-clip--audio:focus-visible {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: -3px;
}
.ui-timeline-clip--midi .ui-timeline-clip__heading {
  padding: 0;
}
.ui-timeline-clip--midi .ui-timeline-clip__handle::after {
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--ui-color-text) 75%, transparent);
  content: "";
  opacity: 0;
}
.ui-timeline-clip__handle--start::after {
  left: 2px;
}
.ui-timeline-clip__handle--end::after {
  right: 2px;
}
.ui-timeline-clip--midi:hover .ui-timeline-clip__handle::after,
.ui-timeline-clip--midi:focus-visible .ui-timeline-clip__handle::after,
.ui-timeline-clip--midi.ui-timeline-clip--selected .ui-timeline-clip__handle::after {
  opacity: 1;
}
</style>
