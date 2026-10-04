import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CustomSeriesOption, LineSeriesOption } from "echarts/charts"
import type {
  GridComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption
} from "echarts/components"
import UiAnalysisPlot from "./UiAnalysisPlot.vue"

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  dispatchAction: vi.fn()
}))
vi.mock("echarts/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("echarts/core")>()),
  init: () => chart
}))

enableAutoUnmount(afterEach)
let resize: (entries: { contentRect: { width: number; height: number } }[]) => void
const disconnect = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resize) {
        resize = callback
      }
      observe = vi.fn()
      disconnect = disconnect
    }
  )
})
afterEach(() => vi.unstubAllGlobals())

const responseProps = {
  label: "Stereo response",
  xLabel: "Hz",
  yLabel: "dB",
  series: []
}
type Option = {
  xAxis: { min: number; max: number; type: string }
  yAxis: { min: number; max: number }
  series: (LineSeriesOption | CustomSeriesOption)[]
  tooltip: TooltipComponentOption
  visualMap: VisualMapComponentOption
  grid: GridComponentOption
}
function option(): Option {
  return chart.setOption.mock.lastCall![0]
}
function tooltip(params: unknown): string {
  const formatter = option().tooltip.formatter as (params: unknown) => string
  return formatter(params)
}
async function mountPlot() {
  const wrapper = mount(UiAnalysisPlot, {
    props: {
      ...responseProps,
      logarithmic: true,
      series: [{ label: "L", x: [20, 200, 2000, 20000], y: [0, -6, -12, -24] }]
    }
  })
  Object.defineProperty(wrapper.get('[aria-hidden="true"]').element, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 900, height: 440 })
  })
  resize([{ contentRect: { width: 900, height: 440 } }])
  await flushPromises()
  await vi.waitFor(() => expect(chart.setOption).toHaveBeenCalled())
  return wrapper
}

describe("UiAnalysisPlot measurement adapter", () => {
  it("labels the plot and gives empty and nonfinite measurements readable domains and gaps", async () => {
    const plot = mount(UiAnalysisPlot, { props: responseProps })
    await flushPromises()
    await vi.waitFor(() => expect(chart.setOption).toHaveBeenCalled())
    expect(plot.get('[role="img"]').attributes("aria-label")).toBe("Stereo response")
    expect(option().xAxis).toMatchObject({ min: 20, max: 20000 })
    expect(option().yAxis).toMatchObject({ min: -1, max: 1 })
    await plot.setProps({
      series: [{ label: "L", x: [20, NaN, 20000, Infinity], y: [-10, null, 0, NaN] }]
    })
    expect(option().series[0]!.data).toEqual([
      [20, -10],
      [null, null],
      [20000, 0],
      [null, null]
    ])
    expect(option().yAxis.min).toBeLessThan(-10)
    expect(Number.isFinite(option().yAxis.max)).toBe(true)
  })

  it("shows each curve's original coordinates and units, omits missing values, and escapes labels", async () => {
    const plot = await mountPlot()
    await plot.setProps({ yLabel: "Level (dB)" })
    expect(
      tooltip([
        { seriesType: "line", seriesName: "L <reference>", value: [1000.125, -6.1234567] },
        { seriesType: "line", seriesName: "R", value: [1000.25, 0] },
        { seriesType: "line", seriesName: "H8", value: [1000, null] }
      ])
    ).toBe(
      "L &lt;reference&gt;<br/>Hz: 1000.125<br/>Level (dB): -6.1234567<br/><br/>R<br/>Hz: 1000.25<br/>Level (dB): 0"
    )
  })

  it("maps column-major FFT measurements to fixed time samples and frequency bands without clipping tooltip levels", async () => {
    const plot = mount(UiAnalysisPlot, {
      props: {
        ...responseProps,
        xLabel: "s",
        yLabel: "Hz",
        xDomain: [0, 6],
        yDomain: [0, 24000],
        heatmap: { columns: 2, rows: 2, values: [-160, 24, -54, NaN] }
      }
    })
    await flushPromises()
    await vi.waitFor(() => expect(chart.setOption).toHaveBeenCalled())
    expect(option().series[0]!.data).toEqual([
      [0, 6000, -160, 0, 3, 0, 12000],
      [0, 18000, 24, 0, 3, 12000, 24000],
      [6, 6000, -54, 3, 6, 0, 12000]
    ])
    const sample = { seriesType: "custom", value: (option().series[0]!.data as number[][])[1] }
    const original = tooltip(sample)
    expect(original).toBe("s: 0<br/>Hz: 12000–24000<br/>24 dBFS")
    await plot.setProps({ colorDomain: [-60, 0] })
    expect(option().visualMap).toMatchObject({ min: -60, max: 0, dimension: 2 })
    expect(tooltip(sample)).toBe(original)
    await plot.setProps({ heatmap: { columns: 1, rows: 1, values: [-30] } })
    expect(option().series[0]!.data).toEqual([[0, 12000, -30, 0, 6, 0, 24000]])
    await plot.setProps({ heatmap: undefined })
    expect(option().series).toEqual([])
    expect(option().visualMap).toEqual([])
  })

  it("resizes the chart and releases its resources when the plot is removed", async () => {
    const plot = await mountPlot()
    resize([{ contentRect: { width: 1100, height: 600 } }])
    await nextTick()
    expect(chart.resize).toHaveBeenLastCalledWith({ width: 1100, height: 600 })
    expect(option().grid).toMatchObject({ width: 1014, height: 536 })
    plot.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(chart.dispose).toHaveBeenCalledOnce()
  })
})

describe("UiAnalysisPlot view gestures", () => {
  it("zooms a logarithmic selection, zooms out in reverse, resets mixed gestures and double clicks, and honors new domains", async () => {
    const plot = await mountPlot()
    const before = option().xAxis
    const gesture = async (x0: number, y0: number, x1: number, y1: number) => {
      await plot.trigger("pointerdown", { button: 0, pointerId: 1, clientX: x0, clientY: y0 })
      await plot.trigger("pointermove", { pointerId: 1, clientX: x1, clientY: y1 })
      await plot.trigger("pointerup", { pointerId: 1, clientX: x1, clientY: y1 })
    }
    await gesture(200, 100, 420, 220)
    expect(option().xAxis.min).toBeGreaterThan(before.min)
    expect(option().xAxis.max).toBeLessThan(before.max)
    expect(option().xAxis.type).toBe("log")
    const zoomed = option().xAxis
    await gesture(420, 220, 200, 100)
    expect(option().xAxis.max / option().xAxis.min).toBeGreaterThan(zoomed.max / zoomed.min)
    await gesture(200, 220, 420, 100)
    expect(option().xAxis).toEqual(before)
    await gesture(200, 100, 420, 220)
    await plot.trigger("dblclick")
    expect(option().xAxis).toEqual(before)
    await gesture(200, 100, 420, 220)
    await plot.setProps({ xDomain: [100, 1000] })
    expect(option().xAxis).toMatchObject({ min: 100, max: 1000 })
  })

  it("pans or zooms just the axis under the wheel, and preserves the view after cancellation", async () => {
    const plot = await mountPlot()
    const before = option().xAxis
    const yBefore = option().yAxis
    await plot.trigger("wheel", { clientX: 400, clientY: 420, deltaY: -1, ctrlKey: true })
    expect(option().xAxis.max / option().xAxis.min).toBeLessThan(before.max / before.min)
    expect(option().yAxis).toEqual(yBefore)
    const xZoomed = option().xAxis
    await plot.trigger("wheel", { clientX: 30, clientY: 200, deltaY: 1 })
    expect(option().yAxis.min).toBeGreaterThan(yBefore.min)
    expect(option().xAxis).toEqual(xZoomed)
    await plot.trigger("pointerdown", { button: 0, clientX: 200, clientY: 100 })
    await plot.trigger("pointermove", { clientX: 420, clientY: 220 })
    await plot.trigger("pointercancel")
    await plot.trigger("pointerup", { clientX: 420, clientY: 220 })
    expect(option().xAxis).toEqual(xZoomed)
  })
})
