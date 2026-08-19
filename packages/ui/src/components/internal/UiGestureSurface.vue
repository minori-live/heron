<script setup lang="ts">
import { shallowRef } from "vue"

import type { UiGestureIntent, UiModifiers, UiPoint } from "../../types"
import { trySetPointerCapture } from "./pointerCapture"

const props = withDefaults(
  defineProps<{
    as?: "div" | "span" | "button"
    label: string
    disabled?: boolean
    coordinateSelector?: string
  }>(),
  { as: "div", disabled: false, coordinateSelector: undefined }
)
const emit = defineEmits<{
  gesture: [intent: UiGestureIntent]
  step: [direction: -1 | 1]
  doubleActivate: [point: UiPoint]
  remove: []
  activate: []
  reorder: [direction: -1 | 1]
}>()

const activePointer = shallowRef<number | null>(null)
const origin = shallowRef<UiPoint>({ x: 0, y: 0 })
const lastPoint = shallowRef<UiPoint>({ x: 0, y: 0 })
const interactiveDescendantSelector = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[draggable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='radio']",
  "[role='separator']",
  "[role='slider']",
  "[role='switch']",
  "[role='tab']",
  "[tabindex]"
].join(",")

function modifiers(event: PointerEvent): UiModifiers {
  return { alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey }
}

function localPoint(event: PointerEvent): UiPoint {
  const current = event.currentTarget as HTMLElement
  const coordinateRoot = props.coordinateSelector
    ? current.closest<HTMLElement>(props.coordinateSelector)
    : null
  const bounds = (coordinateRoot ?? current).getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

function intent(event: PointerEvent, phase: UiGestureIntent["phase"]): UiGestureIntent {
  const point = localPoint(event)
  lastPoint.value = point
  return {
    phase,
    point,
    delta: { x: point.x - origin.value.x, y: point.y - origin.value.y },
    modifiers: modifiers(event)
  }
}

function comesFromInteractiveDescendant(event: Event): boolean {
  const target = event.target
  const current = event.currentTarget
  if (!(target instanceof Element) || !(current instanceof Element) || target === current)
    return false
  const interactive = target.closest(interactiveDescendantSelector)
  return interactive !== null && interactive !== current && current.contains(interactive)
}

function start(event: PointerEvent): void {
  if (props.disabled || comesFromInteractiveDescendant(event)) return
  event.stopPropagation()
  event.preventDefault()
  activePointer.value = event.pointerId
  origin.value = localPoint(event)
  trySetPointerCapture(event.currentTarget as HTMLElement, event.pointerId)
  emit("gesture", intent(event, "start"))
}

function update(event: PointerEvent): void {
  if (event.pointerId !== activePointer.value) return
  event.stopPropagation()
  event.preventDefault()
  emit("gesture", intent(event, "update"))
}

function finish(event: PointerEvent): void {
  if (event.pointerId !== activePointer.value) return
  event.stopPropagation()
  event.preventDefault()
  activePointer.value = null
  emit("gesture", intent(event, "commit"))
}

function cancel(event?: PointerEvent): void {
  if (activePointer.value === null) return
  event?.stopPropagation()
  activePointer.value = null
  emit("gesture", {
    phase: "cancel",
    point: lastPoint.value,
    delta: { x: lastPoint.value.x - origin.value.x, y: lastPoint.value.y - origin.value.y },
    modifiers: { alt: false, control: false, meta: false, shift: false }
  })
}

function keydown(event: KeyboardEvent): void {
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault()
    emit("reorder", event.key === "ArrowUp" ? -1 : 1)
    return
  }
  if (event.key === "Escape") {
    event.preventDefault()
    cancel()
  } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    event.preventDefault()
    emit("step", -1)
  } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    event.preventDefault()
    emit("step", 1)
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault()
    emit("remove")
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    emit("activate")
  }
}

function doubleActivate(event: MouseEvent): void {
  if (props.disabled || comesFromInteractiveDescendant(event)) return
  event.stopPropagation()
  const current = event.currentTarget as HTMLElement
  const coordinateRoot = props.coordinateSelector
    ? current.closest<HTMLElement>(props.coordinateSelector)
    : null
  const bounds = (coordinateRoot ?? current).getBoundingClientRect()
  emit("doubleActivate", { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
}
</script>

<template>
  <component
    :is="props.as"
    :type="props.as === 'button' ? 'button' : undefined"
    :aria-label="props.label"
    :disabled="props.as === 'button' ? props.disabled : undefined"
    @keydown="keydown"
    @dblclick="doubleActivate"
    @pointerdown="start"
    @pointermove="update"
    @pointerup="finish"
    @pointercancel="cancel"
  >
    <slot />
  </component>
</template>
