import { init, use, graphic, type ComposeOption } from "echarts/core"
import {
  LineChart,
  CustomChart,
  type LineSeriesOption,
  type CustomSeriesOption
} from "echarts/charts"
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  type GridComponentOption,
  type TooltipComponentOption,
  type VisualMapComponentOption
} from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import type { AnalysisDomain } from "./analysisView"
import type { UiAnalysisHeatmap, UiAnalysisSeries } from "./types"

use([LineChart, CustomChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])
export { init }

type AnalysisOption = ComposeOption<
  | LineSeriesOption
  | CustomSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | VisualMapComponentOption
>

export interface AnalysisChartInput {
  xLabel: string
  yLabel: string
  series: readonly UiAnalysisSeries[]
  logarithmic: boolean
  xDomain: AnalysisDomain
  yDomain: AnalysisDomain
  heatmap?: UiAnalysisHeatmap
  colorDomain: AnalysisDomain
}

export interface AnalysisChartLayout {
  left: number
  top: number
  width: number
  height: number
}

function tick(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1000) return `${Number((value / 1000).toPrecision(3))}k`
  if (abs > 0 && abs < 0.001) return value.toExponential(1)
  return String(Number(value.toPrecision(3)))
}

function measurement(value: number): string {
  return String(Number(value.toPrecision(8)))
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }
    return entities[character]!
  })
}

/** Keep the original measurements; color limits affect only their display. */
export function analysisHeatmapCells(
  heatmap: UiAnalysisHeatmap,
  xDomain: AnalysisDomain,
  yDomain: AnalysisDomain
): number[][] {
  const cells: number[][] = []
  const dx = (xDomain[1] - xDomain[0]) / Math.max(1, heatmap.columns - 1)
  const dy = (yDomain[1] - yDomain[0]) / heatmap.rows
  for (let column = 0; column < heatmap.columns; column++) {
    // Native FFT windows are centered at column / (columns - 1) of the sweep.
    const x = xDomain[0] + column * dx
    for (let row = 0; row < heatmap.rows; row++) {
      const value = heatmap.values[column * heatmap.rows + row]
      if (value === undefined || !Number.isFinite(value)) continue
      const bottom = yDomain[0] + row * dy
      cells.push([
        x,
        bottom + dy / 2,
        value,
        column === 0 ? xDomain[0] : x - dx / 2,
        column === heatmap.columns - 1 ? xDomain[1] : x + dx / 2,
        bottom,
        bottom + dy
      ])
    }
  }
  return cells
}

export function analysisChartOption(
  input: AnalysisChartInput,
  layout: AnalysisChartLayout,
  style: CSSStyleDeclaration,
  cells: number[][]
): AnalysisOption {
  const token = (name: string): string => style.getPropertyValue(name).trim()
  const color = (value: string): string =>
    value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => token(name))
  const textColor = token("--ui-color-text-subtle")
  const borderColor = token("--ui-color-border")
  const fontFamily = token("--ui-type-family-data")
  const axis = {
    nameTextStyle: { color: textColor, fontFamily },
    axisLabel: { color: textColor, fontFamily, fontSize: 11, formatter: tick, hideOverlap: true },
    axisLine: { lineStyle: { color: borderColor } },
    axisTick: { show: false },
    splitLine: {
      lineStyle: { color: borderColor, opacity: input.heatmap ? 0.18 : 1 }
    },
    axisPointer: { label: { show: false } }
  }
  const series: (LineSeriesOption | CustomSeriesOption)[] = input.series.map((item, index) => ({
    type: "line",
    name: item.label,
    data: item.x.map((x, i) => {
      if (!Number.isFinite(x) || (input.logarithmic && x <= 0)) return [null, null]
      const y = item.y[i]
      return [x, y !== null && y !== undefined && Number.isFinite(y) ? y : null]
    }),
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width: 1.7, type: item.dashed ? "dashed" : "solid" },
    itemStyle: {
      color: color(
        item.color ?? (index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)")
      )
    },
    emphasis: { disabled: true },
    clip: true
  }))
  if (input.heatmap) {
    series.push({
      type: "custom",
      name: "dBFS",
      data: cells,
      encode: { x: [3, 4], y: [5, 6], tooltip: [0, 1, 2] },
      clip: true,
      progressive: 5000,
      renderItem: (_, api) => {
        const lower = api.coord([api.value(3), api.value(5)])
        const upper = api.coord([api.value(4), api.value(6)])
        const shape = graphic.clipRectByRect(
          {
            x: lower[0]!,
            y: upper[1]!,
            width: upper[0]! - lower[0]!,
            height: lower[1]! - upper[1]!
          },
          { x: layout.left, y: layout.top, width: layout.width, height: layout.height }
        )
        return shape ? { type: "rect", shape, style: { fill: api.visual("color") } } : undefined
      }
    })
  }
  return {
    animation: false,
    textStyle: { fontFamily },
    grid: {
      ...layout,
      show: true,
      backgroundColor: token("--ui-color-canvas-subtle"),
      borderWidth: 0,
      // Gesture coordinates use the exact grid rectangle, independent of label extents.
      outerBoundsMode: "none"
    },
    xAxis: {
      ...axis,
      type: input.logarithmic ? "log" : "value",
      min: input.xDomain[0],
      max: input.xDomain[1],
      name: input.xLabel,
      nameLocation: "middle",
      nameGap: 32
    },
    yAxis: {
      ...axis,
      type: "value",
      min: input.yDomain[0],
      max: input.yDomain[1],
      name: input.yLabel,
      nameLocation: "middle",
      nameGap: 46
    },
    tooltip: {
      trigger: input.heatmap ? "item" : "axis",
      triggerOn: "mousemove",
      confine: true,
      transitionDuration: 0,
      backgroundColor: token("--ui-color-surface"),
      borderColor,
      textStyle: { color: token("--ui-color-text"), fontFamily, fontSize: 12 },
      axisPointer: { type: "cross", snap: true },
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params]
        return items
          .flatMap((item) => {
            const value = item.value
            if (!Array.isArray(value) || !Number.isFinite(value[0]) || !Number.isFinite(value[1]))
              return []
            const x = `${escapeHtml(input.xLabel)}: ${measurement(Number(value[0]))}`
            if (item.seriesType === "custom") {
              if (!Number.isFinite(value[2])) return []
              return [
                `${x}<br/>${escapeHtml(input.yLabel)}: ${measurement(Number(value[5]))}–${measurement(Number(value[6]))}<br/>${measurement(Number(value[2]))} dBFS`
              ]
            }
            return [
              `${escapeHtml(item.seriesName ?? "")}<br/>${x}<br/>${escapeHtml(input.yLabel)}: ${measurement(Number(value[1]))}`
            ]
          })
          .join("<br/><br/>")
      }
    },
    visualMap: input.heatmap
      ? {
          type: "continuous",
          min: input.colorDomain[0],
          max: input.colorDomain[1],
          dimension: 2,
          seriesIndex: series.length - 1,
          right: 4,
          top: layout.top,
          itemWidth: 10,
          itemHeight: Math.max(40, layout.height - 40),
          calculable: false,
          text: [`${input.colorDomain[1]}`, `${input.colorDomain[0]}`],
          textStyle: { color: textColor, fontFamily },
          inRange: {
            color: Array.from({ length: 5 }, (_, i) => token(`--ui-analysis-energy-${i}`))
          }
        }
      : [],
    series
  }
}
