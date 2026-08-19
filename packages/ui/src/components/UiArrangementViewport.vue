<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, watch } from "vue"
import type {
  UiDragData,
  UiDropIntent,
  UiModifiers,
  UiPoint,
  UiViewportState,
  UiWheelIntent
} from "../types"

const FILE_PATH_MIME = "application/x-heron-file-path"
const props = withDefaults(
  defineProps<{
    label: string
    mimeTypes?: readonly string[]
    acceptFiles?: boolean
    resolveFiles?: (files: readonly unknown[]) => readonly string[]
    scrollLeft?: number
    railWidth?: number
  }>(),
  { mimeTypes: () => [], acceptFiles: false, resolveFiles: undefined, scrollLeft: 0, railWidth: 0 }
)
const emit = defineEmits<{
  viewport: [state: UiViewportState]
  wheel: [intent: UiWheelIntent]
  dragMove: [intent: UiDropIntent]
  drop: [intent: UiDropIntent]
}>()
const viewport = useTemplateRef<HTMLElement>("viewport")
let observer: ResizeObserver | null = null

function measuredRailWidth(): number {
  const rail = viewport.value?.querySelector<HTMLElement>("[data-ui-arrangement-rail]")
  return rail?.offsetWidth ?? props.railWidth
}

function modifiers(event: WheelEvent): UiModifiers {
  return { alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey }
}
function point(event: DragEvent | WheelEvent): UiPoint {
  const element = viewport.value
  const bounds = element?.getBoundingClientRect()
  return {
    x: Math.max(
      0,
      event.clientX - (bounds?.left ?? 0) + (element?.scrollLeft ?? 0) - measuredRailWidth()
    ),
    y: Math.max(0, event.clientY - (bounds?.top ?? 0) + (element?.scrollTop ?? 0))
  }
}
function state(): void {
  const element = viewport.value
  if (element)
    emit("viewport", {
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      width: Math.max(1, element.clientWidth - measuredRailWidth()),
      height: element.clientHeight
    })
}
function wheel(event: WheelEvent): void {
  if (!(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) return
  event.preventDefault()
  emit("wheel", {
    point: point(event),
    delta: { x: event.deltaX, y: event.deltaY },
    modifiers: modifiers(event)
  })
}
function accepts(event: DragEvent): boolean {
  return (
    (props.acceptFiles && (event.dataTransfer?.files.length ?? 0) > 0) ||
    props.mimeTypes.some((mime) => event.dataTransfer?.types.includes(mime))
  )
}
function dragData(event: DragEvent, includeValues: boolean): UiDragData[] {
  const entries = props.mimeTypes
    .map((mime) => ({
      mime,
      value: includeValues ? (event.dataTransfer?.getData(mime) ?? "") : ""
    }))
    .filter((entry) =>
      includeValues ? entry.value.length > 0 : event.dataTransfer?.types.includes(entry.mime)
    )
  if (includeValues && props.acceptFiles && props.resolveFiles)
    for (const path of props.resolveFiles(Array.from(event.dataTransfer?.files ?? [])))
      entries.push({ mime: FILE_PATH_MIME, value: path })
  return entries
}
function dropIntent(event: DragEvent, includeValues: boolean): UiDropIntent {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-track-id]")
  return {
    point: point(event),
    targetId: target?.dataset.trackId,
    targetKind: target?.dataset.trackKind,
    data: dragData(event, includeValues)
  }
}
function over(event: DragEvent): void {
  if (!accepts(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
  emit("dragMove", dropIntent(event, false))
}
function finish(event: DragEvent): void {
  if (!accepts(event)) return
  event.preventDefault()
  emit("drop", dropIntent(event, true))
}
watch(
  () => props.scrollLeft,
  (value) => {
    if (viewport.value && viewport.value.scrollLeft !== value) viewport.value.scrollLeft = value
  },
  { flush: "post" }
)
onMounted(() => {
  if (!viewport.value) return
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(state)
    observer.observe(viewport.value)
    const rail = viewport.value.querySelector<HTMLElement>("[data-ui-arrangement-rail]")
    if (rail) observer.observe(rail)
  }
  state()
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div
    ref="viewport"
    class="ui-arrangement-viewport"
    :aria-label="props.label"
    @scroll="state"
    @wheel="wheel"
    @dragover="over"
    @drop="finish"
  >
    <slot />
  </div>
</template>
<style scoped>
.ui-arrangement-viewport {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
</style>
