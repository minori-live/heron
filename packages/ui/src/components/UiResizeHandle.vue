<script setup lang="ts">
import { shallowRef } from "vue"

import type { UiGestureIntent, UiModifiers, UiPoint, UiResizeAxis } from "../types"
import { trySetPointerCapture } from "./internal/pointerCapture"

const props = withDefaults(
  defineProps<{
    axis: UiResizeAxis
    label: string
    disabled?: boolean
    keyboardStep?: number
    resetOnDoubleClick?: boolean
    value?: number
    minimum?: number
    maximum?: number
  }>(),
  {
    disabled: false,
    keyboardStep: 10,
    resetOnDoubleClick: false,
    value: undefined,
    minimum: undefined,
    maximum: undefined
  }
)
const emit = defineEmits<{
  gesture: [intent: UiGestureIntent]
  reset: []
}>()

const origin = shallowRef<UiPoint | null>(null)
let activePointer: number | null = null
let lastIntent: UiGestureIntent | null = null

function modifiers(event: MouseEvent | KeyboardEvent): UiModifiers {
  return {
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey
  }
}

function point(event: PointerEvent): UiPoint {
  return { x: event.clientX, y: event.clientY }
}

function intent(event: PointerEvent, phase: UiGestureIntent["phase"]): UiGestureIntent {
  const current = point(event)
  const start = origin.value ?? current
  return {
    phase,
    point: current,
    delta: { x: current.x - start.x, y: current.y - start.y },
    modifiers: modifiers(event)
  }
}

function start(event: PointerEvent): void {
  if (props.disabled || event.button !== 0 || activePointer !== null) return
  event.preventDefault()
  event.stopPropagation()
  activePointer = event.pointerId
  origin.value = point(event)
  ;(event.currentTarget as HTMLElement).focus()
  if (event.currentTarget instanceof HTMLElement)
    trySetPointerCapture(event.currentTarget, event.pointerId)
  lastIntent = intent(event, "start")
  emit("gesture", lastIntent)
}

function update(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return
  event.preventDefault()
  event.stopPropagation()
  lastIntent = intent(event, "update")
  emit("gesture", lastIntent)
}

function finish(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return
  event.preventDefault()
  event.stopPropagation()
  const committed = intent(event, "commit")
  release(event.currentTarget as HTMLElement)
  emit("gesture", committed)
}

function release(target: HTMLElement): void {
  const id = activePointer
  activePointer = null
  origin.value = null
  if (id !== null && target.hasPointerCapture?.(id)) target.releasePointerCapture(id)
}

function cancel(event: PointerEvent | KeyboardEvent): void {
  if (activePointer === null || !lastIntent) return
  if (event instanceof PointerEvent && event.pointerId !== activePointer) return
  event.stopPropagation()
  release(event.currentTarget as HTMLElement)
  emit("gesture", { ...lastIntent, phase: "cancel" })
}

function keydown(event: KeyboardEvent): void {
  if (props.disabled) return
  if (event.key === "Escape" && activePointer !== null) {
    event.preventDefault()
    cancel(event)
    return
  }
  if (event.key === "Home") {
    event.preventDefault()
    emit("reset")
    return
  }
  const negative = props.axis === "horizontal" ? event.key === "ArrowLeft" : event.key === "ArrowUp"
  const positive =
    props.axis === "horizontal" ? event.key === "ArrowRight" : event.key === "ArrowDown"
  if (!negative && !positive) return
  if (activePointer !== null) return
  event.preventDefault()
  event.stopPropagation()
  const amount = (negative ? -1 : 1) * props.keyboardStep
  emit("gesture", {
    phase: "start",
    point: { x: 0, y: 0 },
    delta: { x: 0, y: 0 },
    modifiers: modifiers(event)
  })
  emit("gesture", {
    phase: "commit",
    point: { x: 0, y: 0 },
    delta: props.axis === "horizontal" ? { x: amount, y: 0 } : { x: 0, y: amount },
    modifiers: modifiers(event)
  })
}
</script>

<template>
  <div
    class="ui-resize-handle"
    :class="[`ui-resize-handle--${props.axis}`, { 'ui-resize-handle--active': origin }]"
    role="separator"
    :tabindex="props.disabled ? -1 : 0"
    :aria-label="props.label"
    :aria-orientation="props.axis === 'horizontal' ? 'vertical' : 'horizontal'"
    :aria-disabled="props.disabled || undefined"
    :aria-valuenow="props.value"
    :aria-valuemin="props.minimum"
    :aria-valuemax="props.maximum"
    @dblclick.stop="!props.disabled && props.resetOnDoubleClick && emit('reset')"
    @keydown="keydown"
    @pointerdown="start"
    @pointermove="update"
    @pointerup="finish"
    @pointercancel="cancel"
    @lostpointercapture="cancel"
  >
    <slot />
  </div>
</template>

<style scoped>
.ui-resize-handle {
  position: relative;
  flex: none;
  touch-action: none;
  user-select: none;
}

.ui-resize-handle--horizontal {
  width: var(--ui-space-2);
  cursor: col-resize;
}

.ui-resize-handle--vertical {
  height: var(--ui-space-2);
  cursor: row-resize;
}

.ui-resize-handle::after {
  position: absolute;
  border-radius: var(--ui-radius-pill);
  background: var(--ui-color-border);
  content: "";
  transition: background var(--ui-motion-fast) var(--ui-ease-standard);
}

.ui-resize-handle--horizontal::after {
  top: 0;
  bottom: 0;
  left: calc(50% - 1px);
  width: 2px;
}

.ui-resize-handle--vertical::after {
  right: 0;
  bottom: calc(50% - 1px);
  left: 0;
  height: 2px;
}

.ui-resize-handle:hover::after,
.ui-resize-handle--active::after,
.ui-resize-handle:focus-visible::after {
  background: var(--ui-color-focus);
}
</style>
