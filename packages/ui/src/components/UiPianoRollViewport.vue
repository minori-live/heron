<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, watch } from "vue"
import type { UiKeyboardIntent, UiModifiers, UiViewportState, UiWheelIntent } from "../types"

const props = defineProps<{ label: string; scrollLeft?: number; scrollTop?: number }>()
const emit = defineEmits<{
  focusChange: [focused: boolean]
  keyboard: [intent: UiKeyboardIntent]
  wheel: [intent: UiWheelIntent]
  viewport: [state: UiViewportState]
}>()
const viewport = useTemplateRef<HTMLElement>("viewport")
let observer: ResizeObserver | null = null

function modifiers(event: KeyboardEvent | WheelEvent): UiModifiers {
  return { alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey }
}
function state(): void {
  const element = viewport.value
  if (!element) return
  emit("viewport", {
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    width: element.clientWidth,
    height: element.clientHeight
  })
}
function keyboard(event: KeyboardEvent): void {
  const target = event.target
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
    return
  emit("keyboard", {
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    modifiers: modifiers(event)
  })
}
function wheel(event: WheelEvent): void {
  if (!(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  emit("wheel", {
    point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
    delta: { x: event.deltaX, y: event.deltaY },
    modifiers: modifiers(event)
  })
}
watch(
  () => [props.scrollLeft, props.scrollTop] as const,
  ([left, top]) => {
    if (!viewport.value) return
    if (left !== undefined) viewport.value.scrollLeft = left
    if (top !== undefined) viewport.value.scrollTop = top
  },
  { flush: "post" }
)

onMounted(() => {
  if (!viewport.value) return
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(state)
    observer.observe(viewport.value)
  }
  state()
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div
    ref="viewport"
    class="ui-piano-roll-viewport"
    tabindex="0"
    :aria-label="props.label"
    @focusin="emit('focusChange', true)"
    @focusout="emit('focusChange', false)"
    @keydown="keyboard"
    @wheel="wheel"
    @scroll="state"
  >
    <slot />
  </div>
</template>

<style scoped>
.ui-piano-roll-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  outline: none;
}
.ui-piano-roll-viewport:focus-visible {
  box-shadow: var(--ui-focus-ring);
}
</style>
