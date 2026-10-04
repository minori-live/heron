import { describe, expect, it } from "vitest"
import type { CustomSeriesOption, LineSeriesOption } from "echarts/charts"
import { analysisChartOption, analysisHeatmapCells, type AnalysisChartInput } from "./analysisChart"

const layout = { left: 64, top: 18, width: 800, height: 400 }
const input: AnalysisChartInput = {
  xLabel: "s",
  yLabel: "Hz",
  series: [],
  logarithmic: false,
  xDomain: [0, 6],
  yDomain: [0, 24000],
  colorDomain: [-120, 12]
}

describe("analysis chart adapter", () => {
  it("keeps frequency, small-level and zero axis labels readable without changing their values", () => {
    const option = analysisChartOption(input, layout, document.createElement("div").style, [])
    const axis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis
    if (axis?.type !== "value" && axis?.type !== "log") throw new Error("Expected a numeric axis")
    const formatter = axis?.axisLabel?.formatter
    if (typeof formatter !== "function") throw new Error("Expected the measurement formatter")
    expect(formatter(20000, 0, undefined)).toBe("20k")
    expect(formatter(0.0002, 0, undefined)).toBe("2.0e-4")
    expect(formatter(-0.125, 0, undefined)).toBe("-0.125")
    expect(formatter(0, 0, undefined)).toBe("0")
  })

  it("clips zoomed spectrum cells to the plot while retaining their original measured coordinates", () => {
    const heatmap = { columns: 3, rows: 2, values: [-60, -30, -12, -24, -18, -42] }
    const cells = analysisHeatmapCells(heatmap, [0, 6], [0, 24000])
    const option = analysisChartOption(
      { ...input, xDomain: [2, 4], yDomain: [6000, 18000], heatmap },
      layout,
      document.createElement("div").style,
      cells
    )
    const series = (option.series as CustomSeriesOption[])[0]!
    expect(series.data).toEqual(cells)
    const render = series.renderItem
    if (typeof render !== "function") throw new Error("Expected the spectrum renderer")
    const renderCell = (cell: number[]) =>
      render(
        {} as Parameters<typeof render>[0],
        {
          value: (index: number) => cell[index],
          coord: ([x, y]: number[]) => [64 + (x! - 2) * 400, 418 - (y! - 6000) / 30],
          visual: () => "teal"
        } as unknown as Parameters<typeof render>[1]
      )
    // The center time cell extends beyond the zoomed x range; each band is clipped vertically.
    expect(renderCell(cells[2]!)).toMatchObject({
      type: "rect",
      shape: { x: 64, y: 218, width: 800, height: 200 },
      style: { fill: "teal" }
    })
    expect(renderCell(cells[3]!)).toMatchObject({
      type: "rect",
      shape: { x: 64, y: 18, width: 800, height: 200 }
    })
    expect(renderCell(cells[0]!)).toBeUndefined()
  })

  it("preserves curve styles and measurement gaps when nonpositive frequencies cannot use the log axis", () => {
    const style = document.createElement("div").style
    style.setProperty("--ui-signal-mixer-input", "navy")
    style.setProperty("--ui-color-action", "orange")
    const option = analysisChartOption(
      {
        ...input,
        logarithmic: true,
        xDomain: [20, 20000],
        series: [
          { label: "L", x: [-20, 0, 20, 200], y: [1, 2, 3, null] },
          { label: "R", x: [20, 200], y: [4, 5], dashed: true },
          { label: "Reference", x: [20, 200], y: [6, 7], color: "purple" }
        ]
      },
      layout,
      style,
      []
    )
    const series = option.series as LineSeriesOption[]
    expect(series[0]).toMatchObject({
      data: [
        [null, null],
        [null, null],
        [20, 3],
        [200, null]
      ],
      connectNulls: false,
      itemStyle: { color: "navy" },
      lineStyle: { type: "solid" }
    })
    expect(series[1]).toMatchObject({
      itemStyle: { color: "orange" },
      lineStyle: { type: "dashed" }
    })
    expect(series[2]).toMatchObject({ itemStyle: { color: "purple" } })
  })
})
