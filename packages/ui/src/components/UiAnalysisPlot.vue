<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue"
import type { UiAnalysisHeatmap, UiAnalysisSeries } from "../types"
import type { ECharts } from "echarts/core"
import type * as AnalysisChart from "../analysisChart"
import { axisDomain } from "../analysisAxis"
import {
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
    xUnit?: string
    yUnit?: string
    xMinimumStep?: number
    yMinimumStep?: number
  }>(),
  {
    logarithmic: false,
    colorDomain: () => [-120, 12],
    xDomain: undefined,
    yDomain: undefined,
    heatmap: undefined,
    xUnit: "",
    yUnit: "",
    xMinimumStep: 0,
    yMinimumStep: 0
  }
)
const host = useTemplateRef<HTMLElement>("host")
const chartHost = useTemplateRef<HTMLDivElement>("chartElement")
let chart: ECharts | undefined
const adapter = shallowRef<typeof AnalysisChart>()
const width = ref(900)
const height = ref(440)
const viewX = ref<AnalysisDomain | null>(null)
const viewY = ref<AnalysisDomain | null>(null)
const drag = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
let observer: ResizeObserver | undefined
let themeObserver: MutationObserver | undefined
const autoBounds = computed(() => {
  let minX = Infinity
  let maxX = -Infinity
  let low = 0
  let high = 0
  for (const series of props.series) {
    for (const x of series.x) {
      if (!Number.isFinite(x) || (props.logarithmic && x <= 0)) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
    }
    for (const y of series.y) {
      if (y === null || !Number.isFinite(y)) continue
      low = Math.min(low, y)
      high = Math.max(high, y)
    }
  }
  const padding =
    high === low ? (props.yMinimumStep > 0 ? props.yMinimumStep * 3 : 1) : (high - low) * 0.08
  return {
    x: normalizeDomain(
      props.xDomain ?? (Number.isFinite(minX) ? [minX, maxX] : [20, 20000]),
      props.logarithmic
    ),
    y: normalizeDomain(props.yDomain ?? [low - padding, high + padding], false)
  }
})
const bounds = computed(() => ({
  x: axisDomain(viewX.value ?? autoBounds.value.x, props.xMinimumStep, 8, props.logarithmic),
  y: axisDomain(viewY.value ?? autoBounds.value.y, props.yMinimumStep, 6)
}))
const geometry = computed(() => ({
  left: props.yUnit ? 96 : 64,
  top: 18,
  width: Math.max(
    1,
    width.value - (props.yUnit ? 96 : 64) - (props.heatmap ? (props.yUnit ? 100 : 60) : 22)
  ),
  height: Math.max(1, height.value - 64)
}))
// Heatmap coordinates always use the measurement domain, even after zoom/pan.
const heatmapCells = computed(() => {
  if (!adapter.value || !props.heatmap) return []
  return adapter.value.analysisHeatmapCells(
    props.heatmap,
    normalizeDomain(props.xDomain ?? [20, 20000], props.logarithmic),
    normalizeDomain(props.yDomain ?? [-1, 1], false)
  )
})
function render(): void {
  if (!chart || !adapter.value || !host.value) return
  chart.setOption(
    adapter.value.analysisChartOption(
      {
        xLabel: props.xLabel,
        yLabel: props.yLabel,
        xUnit: props.xUnit,
        yUnit: props.yUnit,
        xMinimumStep: props.xMinimumStep,
        yMinimumStep: props.yMinimumStep,
        series: props.series,
        logarithmic: props.logarithmic,
        xDomain: bounds.value.x,
        yDomain: bounds.value.y,
        heatmap: props.heatmap,
        colorDomain: props.colorDomain
      },
      geometry.value,
      getComputedStyle(host.value),
      heatmapCells.value
    ),
    { notMerge: true }
  )
}
function resetView(): void {
  viewX.value = null
  viewY.value = null
}
function localPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const element = chartHost.value
  if (!element) return { x: 0, y: 0 }
  const rect = element.getBoundingClientRect()
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
  chart?.dispatchAction({ type: "hideTip" })
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
      viewX.value = zoomDomain(
        bounds.value.x,
        valueAt(state.x0, state.y0, "x"),
        2,
        props.logarithmic
      )
    if (vertical)
      viewY.value = zoomDomain(bounds.value.y, valueAt(state.x0, state.y0, "y"), 2, false)
    return
  }
  // Bottom-left → top-right, or any mixed gesture, restores the auto domain.
  resetView()
}
function onWheel(event: WheelEvent): void {
  if (event.deltaY === 0) return
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
      : panDomain(domain, direction * 0.08, logarithmic, props.xMinimumStep)
    if (axis === "x") viewX.value = next
    else viewY.value = next
  }
  if (!yOnly) apply("x")
  if (!xOnly) apply("y")
}
watch(
  () =>
    JSON.stringify([
      props.xDomain,
      props.yDomain,
      props.logarithmic,
      props.xLabel,
      props.yLabel,
      props.xUnit,
      props.yUnit,
      props.xMinimumStep,
      props.yMinimumStep
    ]),
  () => resetView()
)
watch(
  () =>
    [
      props.series,
      props.xLabel,
      props.yLabel,
      props.logarithmic,
      props.heatmap,
      props.colorDomain,
      bounds.value,
      geometry.value
    ] as const,
  render,
  { deep: true }
)
onMounted(async () => {
  if (!chartHost.value) return
  const rect = chartHost.value.getBoundingClientRect()
  width.value = Math.max(320, rect.width)
  height.value = Math.max(200, rect.height)
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      width.value = Math.max(320, entry.contentRect.width)
      height.value = Math.max(200, entry.contentRect.height)
      chart?.resize({ width: width.value, height: height.value })
    })
    if (host.value) observer.observe(host.value)
  }
  // Lazy loading keeps chart code out of the initial desktop renderer bundle.
  adapter.value = await import("../analysisChart")
  if (!chartHost.value) return
  chart = adapter.value.init(chartHost.value, undefined, {
    renderer: "canvas",
    width: width.value,
    height: height.value
  })
  render()
  themeObserver = new MutationObserver(render)
  for (let element = host.value; element; element = element.parentElement) {
    themeObserver.observe(element, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"]
    })
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  themeObserver?.disconnect()
  chart?.dispose()
})
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
    <div ref="chartElement" class="plot-chart" aria-hidden="true" />
    <div
      v-if="drag"
      class="plot-selection"
      :style="{
        left: `${Math.min(drag.x0, drag.x1)}px`,
        top: `${Math.min(drag.y0, drag.y1)}px`,
        width: `${Math.abs(drag.x1 - drag.x0)}px`,
        height: `${Math.abs(drag.y1 - drag.y0)}px`
      }"
    />
  </div>
</template>

<style scoped>
.ui-analysis-plot {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 200px;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}
.plot-chart {
  width: 100%;
  height: 100%;
}
.plot-selection {
  position: absolute;
  pointer-events: none;
  background: color-mix(in srgb, var(--ui-color-action) 12%, transparent);
  border: 1px dashed var(--ui-color-action);
}
</style>
