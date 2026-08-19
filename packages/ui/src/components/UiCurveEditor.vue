<script setup lang="ts">
import { computed, shallowRef, useId, useTemplateRef } from "vue"
import type { UiCurveHandle, UiCurveStroke } from "../types"
import { trySetPointerCapture } from "./internal/pointerCapture"

const props = withDefaults(
  defineProps<{
    curves: readonly UiCurveStroke[]
    handles: readonly UiCurveHandle[]
    xLabel?: string
    yLabel?: string
    disabled?: boolean
  }>(),
  {
    xLabel: "Input",
    yLabel: "Output",
    disabled: false
  }
)

const emit = defineEmits<{
  moveHandle: [change: { id: string; x: number; y: number }]
}>()

const canvas = useTemplateRef<SVGSVGElement>("canvas")
const activeHandleId = shallowRef<string | null>(null)
const selectedHandleId = shallowRef<string | null>(null)
const canvasWidth = 1000
const canvasHeight = 600
const instructionsId = `ui-curve-instructions-${useId()}`

const selectedHandle = computed(() =>
  props.handles.find((handle) => handle.id === selectedHandleId.value)
)

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function curvePath(curve: UiCurveStroke): string {
  return curve.points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x * canvasWidth} ${(1 - point.y) * canvasHeight}`
    )
    .join(" ")
}

function move(handle: UiCurveHandle, x: number, y: number): void {
  emit("moveHandle", {
    id: handle.id,
    x: clamp(x, handle.minX, handle.maxX),
    y: clamp(y, handle.minY, handle.maxY)
  })
}

function beginDrag(event: PointerEvent, handle: UiCurveHandle): void {
  if (props.disabled || event.button !== 0) return
  event.preventDefault()
  activeHandleId.value = handle.id
  selectedHandleId.value = handle.id
  ;(event.currentTarget as SVGGraphicsElement).focus()
  trySetPointerCapture(event.currentTarget as SVGGraphicsElement, event.pointerId)
}

function drag(event: PointerEvent): void {
  if (!activeHandleId.value || !canvas.value) return
  const handle = props.handles.find((candidate) => candidate.id === activeHandleId.value)
  if (!handle) return
  const bounds = canvas.value.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return
  move(
    handle,
    (event.clientX - bounds.left) / bounds.width,
    1 - (event.clientY - bounds.top) / bounds.height
  )
}

function endDrag(): void {
  activeHandleId.value = null
}

function handleKeydown(event: KeyboardEvent, handle: UiCurveHandle): void {
  if (props.disabled) return
  const step = event.shiftKey ? 0.001 : 0.01
  let x = handle.x
  let y = handle.y
  if (event.key === "ArrowLeft") x -= step
  else if (event.key === "ArrowRight") x += step
  else if (event.key === "ArrowDown") y -= step
  else if (event.key === "ArrowUp") y += step
  else if (event.key === "Home") y = handle.minY ?? 0
  else if (event.key === "End") y = handle.maxY ?? 1
  else return
  event.preventDefault()
  selectedHandleId.value = handle.id
  move(handle, x, y)
}
</script>

<template>
  <div class="ui-curve-editor" :data-disabled="props.disabled || undefined">
    <span :id="instructionsId" class="ui-visually-hidden">
      Drag a handle, or focus it and use arrow keys. Hold Shift for fine adjustment. Home and End
      set the minimum and maximum output.
    </span>
    <div class="ui-curve-editor__stage">
      <span class="ui-curve-editor__axis ui-curve-editor__axis--y">{{ props.yLabel }}</span>
      <svg
        ref="canvas"
        class="ui-curve-editor__canvas"
        viewBox="0 0 1000 600"
        role="group"
        aria-label="Editable response curve"
        preserveAspectRatio="xMidYMid meet"
        @pointermove="drag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <path
          class="ui-curve-editor__grid"
          d="M 0 600 L 1000 0 M 0 450 H 1000 M 0 300 H 1000 M 0 150 H 1000 M 250 0 V 600 M 500 0 V 600 M 750 0 V 600"
        />
        <path
          v-for="curve in props.curves"
          :key="curve.id"
          class="ui-curve-editor__curve"
          :d="curvePath(curve)"
        />
        <g
          v-for="handle in props.handles"
          :key="handle.id"
          class="ui-curve-editor__handle"
          :class="[
            `ui-curve-editor__handle--${handle.tone ?? 'primary'}`,
            { 'ui-curve-editor__handle--active': activeHandleId === handle.id }
          ]"
          :transform="`translate(${handle.x * canvasWidth} ${(1 - handle.y) * canvasHeight})`"
          tabindex="0"
          role="slider"
          aria-valuemin="0"
          aria-valuemax="1"
          :aria-valuenow="handle.y"
          :aria-valuetext="`Input ${handle.x.toFixed(3)}, output ${handle.y.toFixed(3)}`"
          :aria-label="handle.label"
          :aria-describedby="instructionsId"
          @focus="selectedHandleId = handle.id"
          @pointerdown="beginDrag($event, handle)"
          @keydown="handleKeydown($event, handle)"
        >
          <circle class="ui-curve-editor__hit-area" r="34" />
          <circle class="ui-curve-editor__handle-ring" r="16" />
          <circle class="ui-curve-editor__handle-core" r="8" />
          <title>
            {{ handle.label }}: input {{ handle.x.toFixed(3) }}, output {{ handle.y.toFixed(3) }}
          </title>
        </g>
      </svg>
      <span class="ui-curve-editor__axis ui-curve-editor__axis--x">{{ props.xLabel }}</span>
    </div>
    <output v-if="selectedHandle" class="ui-curve-editor__readout" aria-live="polite">
      <strong>{{ selectedHandle.label }}</strong>
      <span>Input {{ selectedHandle.x.toFixed(3) }}</span>
      <span>Output {{ selectedHandle.y.toFixed(3) }}</span>
    </output>
    <p v-else class="ui-curve-editor__hint">Drag a handle to shape the response curve.</p>
  </div>
</template>

<style scoped>
.ui-curve-editor {
  display: grid;
  min-width: 0;
  gap: var(--ui-space-2);
}

.ui-curve-editor[data-disabled="true"] {
  opacity: var(--ui-opacity-disabled);
}

.ui-curve-editor__stage {
  position: relative;
  padding: 18px 12px 24px 38px;
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-color-canvas-subtle);
}

.ui-curve-editor__canvas {
  display: block;
  width: 100%;
  max-height: 300px;
  aspect-ratio: 5 / 3;
  overflow: visible;
  touch-action: none;
}

.ui-curve-editor__grid {
  fill: none;
  stroke: var(--ui-color-border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.ui-curve-editor__curve {
  fill: none;
  stroke: var(--ui-color-action);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.ui-curve-editor__handle {
  color: var(--ui-color-action);
  cursor: grab;
  outline: none;
}

.ui-curve-editor__handle--secondary {
  color: var(--ui-color-text-muted);
}

.ui-curve-editor__handle:active {
  cursor: grabbing;
}

.ui-curve-editor__hit-area {
  fill: transparent;
  stroke: none;
}

.ui-curve-editor__handle-ring {
  fill: var(--ui-color-canvas-subtle);
  stroke: currentColor;
  stroke-width: 5;
}

.ui-curve-editor__handle-core {
  fill: currentColor;
}

.ui-curve-editor__handle:hover .ui-curve-editor__handle-ring,
.ui-curve-editor__handle:focus-visible .ui-curve-editor__handle-ring,
.ui-curve-editor__handle--active .ui-curve-editor__handle-ring {
  fill: var(--ui-color-selection);
  stroke-width: 7;
}

.ui-curve-editor__handle:focus-visible .ui-curve-editor__hit-area {
  stroke: var(--ui-color-focus);
  stroke-width: 4;
}

.ui-curve-editor__axis,
.ui-curve-editor__hint,
.ui-curve-editor__readout {
  color: var(--ui-color-text-muted);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}

.ui-curve-editor__axis {
  position: absolute;
  letter-spacing: var(--ui-type-tracking-wide);
  text-transform: uppercase;
}

.ui-curve-editor__axis--y {
  top: 50%;
  left: 8px;
  transform: rotate(-90deg) translateX(-50%);
  transform-origin: left top;
}

.ui-curve-editor__axis--x {
  right: 12px;
  bottom: 7px;
}

.ui-curve-editor__readout {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-space-3);
  min-height: 24px;
  align-items: center;
}

.ui-curve-editor__readout strong {
  color: var(--ui-color-text);
}

.ui-curve-editor__hint {
  min-height: 24px;
  margin: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ui-curve-editor__handle-ring {
    transition: none;
  }
}
</style>
