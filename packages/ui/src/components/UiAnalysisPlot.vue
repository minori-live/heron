<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from "vue"
import type { UiAnalysisHeatmap, UiAnalysisSeries } from "../types"
import {
  fractionAtValue,
  normalizeDomain,
  panDomain,
  valueAtFraction,
  zoomDomain,
  type AnalysisDomain
} from "../analysisView"

const props = withDefaults(
  defineProps<{
    label: string
    xLabel: string
    yLabel: string
    series: readonly UiAnalysisSeries[]
    logarithmic?: boolean
    xDomain?: readonly [number, number]
    yDomain?: readonly [number, number]
    heatmap?: UiAnalysisHeatmap
    colorDomain?: readonly [number, number]
  }>(),
  {
    logarithmic: false,
    colorDomain: () => [-120, 12],
    xDomain: undefined,
    yDomain: undefined,
    heatmap: undefined
  }
)
const host = useTemplateRef<HTMLElement>("host")
const chart = useTemplateRef<SVGSVGElement>("chart")
const width = ref(900)
const height = ref(440)
const raster = ref("")
const clipId = `analysis-${useId().replace(/:/g, "")}`
const viewX = ref<AnalysisDomain | null>(null)
const viewY = ref<AnalysisDomain | null>(null)
const drag = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
let observer: ResizeObserver | undefined
const bounds = computed(() => {
  const xs = props.series.flatMap((s) => [...s.x]).filter(Number.isFinite)
  const ys = props.series.flatMap((s) =>
    s.y.filter((v): v is number => v !== null && Number.isFinite(v))
  )
  const low = Math.min(...ys, 0)
  const high = Math.max(...ys, 0)
  const padding = high === low ? 1 : (high - low) * 0.08
  return {
    x:
      viewX.value ??
      props.xDomain ??
      [xs.length ? Math.min(...xs) : 20, xs.length ? Math.max(...xs) : 20000],
    y: viewY.value ?? props.yDomain ?? [low - padding, high + padding]
  }
})
const geometry = computed(() => ({
  left: 64,
  top: 18,
  width: Math.max(1, width.value - (props.heatmap ? 124 : 86)),
  height: Math.max(1, height.value - 64)
}))
function xPosition(value: number): number {
  return (
    geometry.value.left +
    fractionAtValue(bounds.value.x, value, props.logarithmic) * geometry.value.width
  )
}
function yPosition(value: number): number {
  const [min, max] = bounds.value.y
  return geometry.value.top + (1 - (value - min) / (max - min || 1)) * geometry.value.height
}
const heatRect = computed(() => {
  if (!props.heatmap) return undefined
  const x0 = props.xDomain?.[0] ?? bounds.value.x[0]
  const x1 = props.xDomain?.[1] ?? bounds.value.x[1]
  const y0 = props.yDomain?.[0] ?? bounds.value.y[0]
  const y1 = props.yDomain?.[1] ?? bounds.value.y[1]
  const left = xPosition(x0)
  const right = xPosition(x1)
  const bottom = yPosition(y0)
  const top = yPosition(y1)
  return { x: left, y: top, width: right - left, height: bottom - top }
})
const xTicks = computed(() => {
  const [min, max] = bounds.value.x
  if (props.logarithmic) {
    const ticks: number[] = []
    for (
      let power = Math.floor(Math.log10(Math.max(1e-12, min)));
      power <= Math.ceil(Math.log10(max));
      power++
    )
      for (const factor of [1, 2, 5]) {
        const value = factor * 10 ** power
        if (value >= min && value <= max) ticks.push(value)
      }
    return ticks
  }
  return Array.from({ length: 9 }, (_, i) => min + ((max - min) * i) / 8)
})
const yTicks = computed(() => {
  const [min, max] = bounds.value.y
  return Array.from({ length: 7 }, (_, i) => min + ((max - min) * i) / 6)
})
const curves = computed(() =>
  props.series.map((series, index) => {
    let path = ""
    let connected = false
    series.y.forEach((y, i) => {
      const x = series.x[i]
      if (y === null || !Number.isFinite(y) || x === undefined || !Number.isFinite(x)) {
        connected = false
        return
      }
      path += `${connected ? "L" : "M"}${xPosition(x).toFixed(2)},${yPosition(y).toFixed(2)} `
      connected = true
    })
    return {
      ...series,
      path,
      color: series.color ?? (index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)")
    }
  })
)
function tick(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1000) return `${Number((value / 1000).toPrecision(3))}k`
  if (abs > 0 && abs < 0.001) return value.toExponential(1)
  return String(Number(value.toPrecision(3)))
}
function paintHeatmap(): void {
  const data = props.heatmap
  if (!data) {
    raster.value = ""
    return
  }
  const canvas = document.createElement("canvas")
  canvas.width = data.columns
  canvas.height = data.rows
  const context = canvas.getContext("2d")
  if (!context) return
  const pixels = context.createImageData(data.columns, data.rows)
  // Blue → cyan → green → yellow → red, matching the measured energy legend.
  const stops = [
    [16, 35, 125],
    [0, 185, 239],
    [49, 215, 95],
    [255, 229, 56],
    [235, 47, 32]
  ]
  const [low, high] = props.colorDomain
  for (let column = 0; column < data.columns; column++) {
    for (let row = 0; row < data.rows; row++) {
      const value = data.values[column * data.rows + row] ?? low
      const position = Math.max(0, Math.min(1, (value - low) / Math.max(1, high - low))) * 4
      const lower = Math.min(3, Math.floor(position))
      const fraction = position - lower
      const offset = ((data.rows - row - 1) * data.columns + column) * 4
      for (let rgb = 0; rgb < 3; rgb++)
        pixels.data[offset + rgb] = Math.round(
          stops[lower]![rgb]! * (1 - fraction) + stops[lower + 1]![rgb]! * fraction
        )
      pixels.data[offset + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  raster.value = canvas.toDataURL()
}
function resetView(): void {
  viewX.value = null
  viewY.value = null
}
function localPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const svg = chart.value
  if (!svg) return { x: 0, y: 0 }
  const rect = svg.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) * width.value) / (rect.width || 1),
    y: ((event.clientY - rect.top) * height.value) / (rect.height || 1)
  }
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  const point = localPoint(event)
  if (
    point.x < geometry.value.left ||
    point.x > geometry.value.left + geometry.value.width ||
    point.y < geometry.value.top ||
    point.y > geometry.value.top + geometry.value.height
  )
    return
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  drag.value = { x0: point.x, y0: point.y, x1: point.x, y1: point.y }
}
function onPointerMove(event: PointerEvent): void {
  if (!drag.value) return
  const point = localPoint(event)
  drag.value = { ...drag.value, x1: point.x, y1: point.y }
}
function valueAt(pointX: number, pointY: number, axis: "x" | "y"): number {
  const { left, top, width: w, height: h } = geometry.value
  return axis === "x"
    ? valueAtFraction(bounds.value.x, (pointX - left) / w, props.logarithmic)
    : valueAtFraction(bounds.value.y, 1 - (pointY - top) / h, false)
}
function onPointerUp(event: PointerEvent): void {
  const state = drag.value
  drag.value = null
  if (!state) return
  if ((event.currentTarget as Element).hasPointerCapture?.(event.pointerId))
    (event.currentTarget as Element).releasePointerCapture(event.pointerId)
  const dx = state.x1 - state.x0
  const dy = state.y1 - state.y0
  const horizontal = Math.abs(dx) > 8
  const vertical = Math.abs(dy) > 8
  if (!horizontal && !vertical) return
  if (dx > 0 && dy > 0) {
    // Top-left → bottom-right selects a region to zoom into.
    const x0 = valueAt(state.x0, state.y0, "x")
    const x1 = valueAt(state.x1, state.y1, "x")
    const y0 = valueAt(state.x0, state.y0, "y")
    const y1 = valueAt(state.x1, state.y1, "y")
    if (horizontal) viewX.value = normalizeDomain([x0, x1], props.logarithmic)
    if (vertical) viewY.value = normalizeDomain([y0, y1], false)
    return
  }
  if (dx < 0 && dy < 0) {
    // Bottom-right → top-left zooms out around the current center.
    if (horizontal)
      viewX.value = zoomDomain(bounds.value.x, valueAt(state.x0, state.y0, "x"), 2, props.logarithmic)
    if (vertical)
      viewY.value = zoomDomain(bounds.value.y, valueAt(state.x0, state.y0, "y"), 2, false)
    return
  }
  // Bottom-left → top-right, or any mixed gesture, restores the auto domain.
  resetView()
}
function onWheel(event: WheelEvent): void {
  const point = localPoint(event)
  const { left, top, width: w, height: h } = geometry.value
  const insideX = point.x >= left && point.x <= left + w
  const insideY = point.y >= top && point.y <= top + h
  if (!insideX && !insideY) return
  event.preventDefault()
  const yOnly = point.x < left
  const xOnly = !yOnly && point.y > top + h
  const zoom = event.ctrlKey || event.metaKey
  const direction = event.deltaY > 0 ? 1 : -1
  const factor = direction > 0 ? 1.15 : 1 / 1.15
  const apply = (axis: "x" | "y"): void => {
    const domain: AnalysisDomain = axis === "x" ? bounds.value.x : bounds.value.y
    const logarithmic = axis === "x" && props.logarithmic
    const next = zoom
      ? zoomDomain(domain, valueAt(point.x, point.y, axis), factor, logarithmic)
      : panDomain(domain, direction * 0.08, logarithmic)
    if (axis === "x") viewX.value = next
    else viewY.value = next
  }
  if (!yOnly) apply("x")
  if (!xOnly) apply("y")
}
watch(
  () => JSON.stringify([props.xDomain, props.yDomain]),
  () => resetView()
)
watch(() => [props.heatmap, props.colorDomain] as const, paintHeatmap)
onMounted(() => {
  paintHeatmap()
  if (typeof ResizeObserver === "undefined") return
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return
    width.value = Math.max(320, entry.contentRect.width)
    height.value = Math.max(200, entry.contentRect.height)
  })
  if (host.value) observer.observe(host.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div
    ref="host"
    class="ui-analysis-plot"
    role="img"
    :aria-label="label"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="drag = null"
    @wheel="onWheel"
    @dblclick="resetView"
  >
    <svg ref="chart" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
      <defs>
        <clipPath :id="clipId">
          <rect
            :x="geometry.left"
            :y="geometry.top"
            :width="geometry.width"
            :height="geometry.height"
          />
        </clipPath>
        <linearGradient :id="`${clipId}-energy`" x1="0" x2="0" y1="1" y2="0">
          <stop offset="0" stop-color="var(--ui-analysis-energy-0)" />
          <stop offset="25%" stop-color="var(--ui-analysis-energy-1)" />
          <stop offset="50%" stop-color="var(--ui-analysis-energy-2)" />
          <stop offset="75%" stop-color="var(--ui-analysis-energy-3)" />
          <stop offset="100%" stop-color="var(--ui-analysis-energy-4)" />
        </linearGradient>
      </defs>
      <rect
        class="plot-background"
        :x="geometry.left"
        :y="geometry.top"
        :width="geometry.width"
        :height="geometry.height"
      />
      <g :clip-path="`url(#${clipId})`">
        <image
          v-if="raster && heatRect"
          :href="raster"
          :x="heatRect.x"
          :y="heatRect.y"
          :width="heatRect.width"
          :height="heatRect.height"
          preserveAspectRatio="none"
        />
      </g>
      <g class="plot-grid" :class="{ 'plot-grid--heatmap': heatmap }">
        <line
          v-for="value in xTicks"
          :key="`x${value}`"
          :x1="xPosition(value)"
          :x2="xPosition(value)"
          :y1="geometry.top"
          :y2="geometry.top + geometry.height"
        />
        <line
          v-for="value in yTicks"
          :key="`y${value}`"
          :x1="geometry.left"
          :x2="geometry.left + geometry.width"
          :y1="yPosition(value)"
          :y2="yPosition(value)"
        />
      </g>
      <line
        v-if="!heatmap && bounds.y[0]! < 0 && bounds.y[1]! > 0"
        class="zero-line"
        :x1="geometry.left"
        :x2="geometry.left + geometry.width"
        :y1="yPosition(0)"
        :y2="yPosition(0)"
      />
      <g :clip-path="`url(#${clipId})`">
        <path
          v-for="(curve, index) in curves"
          :key="index"
          class="response"
          :d="curve.path"
          :stroke="curve.color"
          :stroke-dasharray="curve.dashed ? '5 4' : undefined"
        />
      </g>
      <g class="axis-labels">
        <text
          v-for="value in xTicks"
          :key="`label-x${value}`"
          :x="xPosition(value)"
          :y="geometry.top + geometry.height + 22"
          text-anchor="middle"
        >
          {{ tick(value) }}
        </text>
        <text
          v-for="value in yTicks"
          :key="`label-y${value}`"
          :x="geometry.left - 12"
          :y="yPosition(value) + 4"
          text-anchor="end"
        >
          {{ tick(value) }}
        </text>
        <text :x="geometry.left + geometry.width" :y="height - 7" text-anchor="end">
          {{ xLabel }}
        </text>
        <text
          x="14"
          :y="geometry.top + geometry.height / 2"
          :transform="`rotate(-90 14 ${geometry.top + geometry.height / 2})`"
          text-anchor="middle"
        >
          {{ yLabel }}
        </text>
      </g>
      <g v-if="heatmap" class="axis-labels">
        <rect
          :x="geometry.left + geometry.width + 16"
          :y="geometry.top"
          width="10"
          :height="geometry.height"
          :fill="`url(#${clipId}-energy)`"
        />
        <text :x="width - 8" :y="geometry.top + 4" text-anchor="end">{{ colorDomain[1] }}</text>
        <text :x="width - 8" :y="geometry.top + geometry.height" text-anchor="end">
          {{ colorDomain[0] }}
        </text>
      </g>
      <rect
        v-if="drag"
        class="plot-selection"
        :x="Math.min(drag.x0, drag.x1)"
        :y="Math.min(drag.y0, drag.y1)"
        :width="Math.abs(drag.x1 - drag.x0)"
        :height="Math.abs(drag.y1 - drag.y0)"
      />
    </svg>
  </div>
</template>

<style scoped>
.ui-analysis-plot {
  width: 100%;
  height: 100%;
  min-height: 200px;
  overflow: hidden;
}
.ui-analysis-plot svg {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
}
.plot-background {
  fill: var(--ui-color-canvas-subtle);
}
.plot-grid {
  stroke: var(--ui-color-border);
  stroke-width: 1;
}
.plot-grid--heatmap {
  opacity: 0.18;
}
.zero-line {
  stroke: var(--ui-color-text-faint);
  stroke-width: 1;
}
.response {
  fill: none;
  stroke-width: 1.7;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.plot-selection {
  fill: var(--ui-color-action);
  fill-opacity: 0.12;
  stroke: var(--ui-color-action);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.axis-labels {
  fill: var(--ui-color-text-subtle);
  font: var(--ui-type-size-section-title) var(--ui-type-family-data);
}
</style>
