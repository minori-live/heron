<script setup lang="ts">
import type { UiAutomationLanePoint, UiGestureIntent, UiPoint } from "../types"
import UiGestureSurface from "./internal/UiGestureSurface.vue"

const props = withDefaults(
  defineProps<{
    mode: "value" | "marker"
    label: string
    width: number
    height: number
    color?: string
    points: readonly UiAutomationLanePoint[]
    verticalGuides?: readonly number[]
    beatGuides?: readonly number[]
    horizontalGuides?: readonly { position: number; label: string }[]
    linePath?: string
    fillPath?: string
  }>(),
  {
    color: undefined,
    verticalGuides: () => [],
    beatGuides: () => [],
    horizontalGuides: () => [],
    linePath: "",
    fillPath: ""
  }
)
const emit = defineEmits<{
  create: [point: UiPoint]
  clearSelection: []
  pointGesture: [id: string, intent: UiGestureIntent]
  remove: [id: string]
}>()

function surfaceGesture(intent: UiGestureIntent): void {
  if (intent.phase === "start") emit("clearSelection")
}
</script>

<template>
  <UiGestureSurface
    class="ui-automation-lane"
    :class="`ui-automation-lane--${props.mode}`"
    :style="{
      width: `${props.width}px`,
      height: `${props.height}px`,
      '--ui-lane-color': props.color
    }"
    :label="props.label"
    @gesture="surfaceGesture"
    @double-activate="emit('create', $event)"
  >
    <span
      v-for="guide in props.beatGuides"
      :key="`beat-${guide}`"
      class="ui-automation-lane__guide ui-automation-lane__guide--beat"
      :style="{ left: `${guide}px` }"
    />
    <span
      v-for="guide in props.verticalGuides"
      :key="`vertical-${guide}`"
      class="ui-automation-lane__guide"
      :style="{ left: `${guide}px` }"
    />
    <svg
      v-if="props.mode === 'value'"
      class="ui-automation-lane__graph"
      :width="props.width"
      :height="props.height"
      aria-hidden="true"
    >
      <g v-for="guide in props.horizontalGuides" :key="guide.position">
        <line x1="0" :x2="props.width" :y1="guide.position" :y2="guide.position" />
        <text x="7" :y="Math.max(9, guide.position - 4)">{{ guide.label }}</text>
      </g>
      <path class="ui-automation-lane__fill" :d="props.fillPath" />
      <path class="ui-automation-lane__shadow" :d="props.linePath" />
      <path class="ui-automation-lane__line" :d="props.linePath" />
    </svg>
    <span
      v-for="point in props.mode === 'marker' ? props.points : []"
      :key="`segment-${point.id}`"
      class="ui-automation-lane__segment"
      :class="{ 'ui-automation-lane__segment--selected': point.selected }"
      :style="{ left: `${point.x}px`, width: `${point.segmentWidth ?? 0}px` }"
      ><b>{{ point.segmentLabel }}</b></span
    >
    <UiGestureSurface
      v-for="point in props.points"
      :key="point.id"
      as="button"
      coordinate-selector=".ui-automation-lane"
      class="ui-automation-lane__point"
      :class="{ 'ui-automation-lane__point--selected': point.selected }"
      :style="{ left: `${point.x}px`, top: props.mode === 'value' ? `${point.y}px` : undefined }"
      :label="point.label"
      @gesture="emit('pointGesture', point.id, $event)"
      @remove="point.removable !== false && emit('remove', point.id)"
    />
  </UiGestureSurface>
</template>

<style scoped>
.ui-automation-lane {
  --ui-lane-color: var(--ui-color-action);
  position: relative;
  min-width: 100%;
  overflow: hidden;
  border-bottom: 1px solid var(--ui-color-border-strong);
  background: var(--ui-color-surface-sunken);
  cursor: crosshair;
  user-select: none;
}
.ui-automation-lane:focus-visible {
  box-shadow: 0 0 0 1px var(--ui-color-focus) inset;
}
.ui-automation-lane__guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--ui-color-border);
  pointer-events: none;
}
.ui-automation-lane__guide--beat {
  opacity: 0.32;
}
.ui-automation-lane__graph {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
.ui-automation-lane__graph line {
  stroke: var(--ui-color-border);
  stroke-width: 1;
  stroke-dasharray: 2 4;
}
.ui-automation-lane__graph text {
  fill: var(--ui-color-text-subtle);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
}
.ui-automation-lane__fill {
  fill: color-mix(in srgb, var(--ui-lane-color) 15%, transparent);
}
.ui-automation-lane__shadow {
  fill: none;
  stroke: var(--ui-color-overlay);
  stroke-width: 4;
}
.ui-automation-lane__line {
  fill: none;
  stroke: var(--ui-lane-color);
  stroke-width: 1.5;
}
.ui-automation-lane__segment {
  position: absolute;
  top: 11px;
  bottom: 10px;
  overflow: hidden;
  border-block: 1px solid color-mix(in srgb, var(--ui-lane-color) 45%, transparent);
  background: color-mix(in srgb, var(--ui-lane-color) 10%, transparent);
  pointer-events: none;
}
.ui-automation-lane__segment--selected {
  background: color-mix(in srgb, var(--ui-lane-color) 19%, transparent);
}
.ui-automation-lane__segment b {
  display: block;
  padding: 6px 10px;
  overflow: hidden;
  color: var(--ui-lane-color);
  font: var(--ui-type-weight-bold) var(--ui-type-size-control) var(--ui-type-family-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ui-automation-lane__point {
  position: absolute;
  z-index: var(--ui-z-local-raised);
  width: 9px;
  height: 9px;
  padding: 0;
  border: 2px solid var(--ui-color-surface-sunken);
  border-radius: var(--ui-radius-pill);
  background: var(--ui-lane-color);
  box-shadow: 0 0 0 1px var(--ui-lane-color);
  transform: translate(-50%, -50%);
  cursor: grab;
}
.ui-automation-lane--marker .ui-automation-lane__point {
  top: 6px;
  bottom: 6px;
  height: auto;
  border-radius: var(--ui-radius-sm);
  transform: translateX(-50%);
  cursor: ew-resize;
}
.ui-automation-lane__point:hover,
.ui-automation-lane__point--selected,
.ui-automation-lane__point:focus-visible {
  width: 11px;
  border-color: var(--ui-color-text);
  outline: 2px solid var(--ui-color-focus);
  outline-offset: 2px;
}
</style>
