<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from "vue"
import type { UiAnalysisHeatmap, UiAnalysisSeries } from "../types"

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
const width = ref(900)
const height = ref(440)
const raster = ref("")
const clipId = `analysis-${useId().replace(/:/g, "")}`
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
    x: props.xDomain ?? [xs.length ? Math.min(...xs) : 20, xs.length ? Math.max(...xs) : 20000],
    y: props.yDomain ?? [low - padding, high + padding]
  }
})
const geometry = computed(() => ({
  left: 64,
  top: 18,
  width: Math.max(1, width.value - (props.heatmap ? 124 : 86)),
  height: Math.max(1, height.value - 64)
}))
function xPosition(value: number): number {
  const [min, max] = bounds.value.x
  const scale = (v: number) => (props.logarithmic ? Math.log(Math.max(1e-12, v)) : v)
  return (
    geometry.value.left +
    ((scale(value) - scale(min)) / (scale(max) - scale(min) || 1)) * geometry.value.width
  )
}
function yPosition(value: number): number {
  const [min, max] = bounds.value.y
  return geometry.value.top + (1 - (value - min) / (max - min || 1)) * geometry.value.height
}
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
watch(() => [props.heatmap, props.colorDomain] as const, paintHeatmap)
onMounted(() => {
  paintHeatmap()
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
  <div ref="host" class="ui-analysis-plot" role="img" :aria-label="label">
    <svg :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
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
      <image
        v-if="raster"
        :href="raster"
        :x="geometry.left"
        :y="geometry.top"
        :width="geometry.width"
        :height="geometry.height"
        preserveAspectRatio="none"
      />
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
svg {
  display: block;
  width: 100%;
  height: 100%;
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
.axis-labels {
  fill: var(--ui-color-text-subtle);
  font: var(--ui-type-size-section-title) var(--ui-type-family-data);
}
</style>
