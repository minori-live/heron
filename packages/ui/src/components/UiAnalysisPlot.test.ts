import { enableAutoUnmount, mount } from "@vue/test-utils"
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
  init: vi.fn(),
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  dispatchAction: vi.fn()
}))
vi.mock("echarts/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("echarts/core")>()),
  init: () => chart.init()
}))

enableAutoUnmount(afterEach)
let resize: (entries: { contentRect: { width: number; height: number } }[]) => void
const disconnect = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  chart.init.mockReturnValue(chart)
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
  xAxis: {
    min: number
    max: number
    type: string
    minInterval?: number
    axisLabel: { formatter: (value: number) => string }
  }
  yAxis: {
    min: number
    max: number
    minInterval?: number
    axisLabel: { formatter: (value: number) => string }
  }
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
    value: () => ({ left: 0, top: 0, width: 900, height: 440 }),
    configurable: true
  })
  resize([{ contentRect: { width: 900, height: 440 } }])
  await vi.dynamicImportSettled()
  expect(chart.setOption).toHaveBeenCalled()
  return wrapper
}

describe("UiAnalysisPlot measurement adapter", () => {
  it("labels the plot and gives empty and nonfinite measurements readable domains and gaps", async () => {
    const plot = mount(UiAnalysisPlot, { props: responseProps })
    await vi.dynamicImportSettled()
    expect(chart.setOption).toHaveBeenCalled()
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
    await vi.dynamicImportSettled()
    expect(chart.setOption).toHaveBeenCalled()
    expect(option().series[0]!.data).toEqual([
      [0, 6000, -160, 0, 3, 0, 12000],
      [0, 18000, 24, 0, 3, 12000, 24000],
      [6, 6000, -54, 3, 6, 0, 12000]
    ])
    const sample = { seriesType: "custom", value: (option().series[0]!.data as number[][])[1] }
    const original = tooltip(sample)
    expect(original).toBe("s: 0<br/>Hz: 12000–24000<br/>24 dBFS")
    expect(tooltip({ seriesType: "custom", value: [0, 12000, NaN, 0, 3, 0, 24000] })).toBe("")
    await plot.setProps({ colorDomain: [-60, 0] })
    expect(option().visualMap).toMatchObject({
      min: -60,
      max: 0,
      dimension: 2,
      text: ["0 dBFS", "-60 dBFS"]
    })
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

  it("does not create chart resources when removed before the lazy adapter finishes loading", async () => {
    const plot = mount(UiAnalysisPlot, { props: responseProps })
    plot.unmount()
    await vi.dynamicImportSettled()
    expect(chart.init).not.toHaveBeenCalled()
    expect(chart.setOption).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

async function mountInteractivePlot() {
  const plot = await mountPlot()
  await plot.setProps({ logarithmic: false, xDomain: [0, 800], yDomain: [-60, 0] })
  Object.defineProperty(plot.get('[aria-hidden="true"]').element, "getBoundingClientRect", {
    value: () => ({ left: 100, top: 50, width: 450, height: 220 }),
    configurable: true
  })
  const point = (x: number, y: number) => ({ clientX: 100 + x / 2, clientY: 50 + y / 2 })
  const pointer = (event: string, x: number, y: number, button = 0) =>
    plot.trigger(event, { button, pointerId: 1, ...point(x, y) })
  const drag = async (from: [number, number], to: [number, number], button = 0) => {
    await pointer("pointerdown", ...from, button)
    await pointer("pointermove", ...to)
    await pointer("pointerup", ...to)
  }
  const wheel = async (x: number, y: number, options: WheelEventInit = {}) => {
    // happy-dom's WheelEvent drops MouseEvent coordinates and modifiers.
    const event = new MouseEvent("wheel", {
      ...point(x, y),
      bubbles: true,
      cancelable: true,
      ...options
    })
    Object.defineProperty(event, "deltaY", { value: options.deltaY ?? 1 })
    plot.element.dispatchEvent(event)
    await nextTick()
    return event
  }
  const domains = () => ({
    x: [option().xAxis.min, option().xAxis.max],
    y: [option().yAxis.min, option().yAxis.max]
  })
  return { plot, pointer, drag, wheel, domains }
}

describe("UiAnalysisPlot navigation", () => {
  it("applies unit resolution to automatic, explicit, wheel and rectangle domains while retaining measurements", async () => {
    const { plot, drag, wheel, domains } = await mountInteractivePlot()
    await plot.setProps({
      xUnit: "Hz",
      yUnit: "°",
      xMinimumStep: 1,
      yMinimumStep: 1,
      yDomain: undefined,
      series: [{ label: "L", x: [20, 20000], y: [-1e-8, 1e-8] }]
    })
    expect(domains().y).toEqual([-3, 3])
    expect(option().yAxis.minInterval).toBe(1)
    expect(option().yAxis.axisLabel.formatter(3)).toBe("3°")
    expect(option().series[0]!.data).toEqual([
      [20, -1e-8],
      [20000, 1e-8]
    ])
    for (let i = 0; i < 40; i++) await wheel(32, 206, { ctrlKey: true, deltaY: -1 })
    expect(domains().y[1]! - domains().y[0]!).toBeGreaterThanOrEqual(6 - 1e-10)
    await drag([300, 180], [320, 200])
    expect(domains().x[1]! - domains().x[0]!).toBeGreaterThanOrEqual(8 - 1e-10)
    expect(domains().y[1]! - domains().y[0]!).toBeGreaterThanOrEqual(6 - 1e-10)
    await plot.setProps({ yDomain: [-1e-7, 1e-7], yUnit: "%", yMinimumStep: 0.01 })
    expect(domains().y[1]! - domains().y[0]!).toBeCloseTo(0.06)
    expect(option().yAxis.axisLabel.formatter(0.02)).toBe("0.02%")
    await plot.setProps({ xDomain: [20, 20000], logarithmic: true })
    for (let i = 0; i < 50; i++) await wheel(471, 420, { deltaY: -1 })
    expect(domains().x[0]).toBeGreaterThanOrEqual(1)
    expect(domains().x[1]! - domains().x[0]!).toBeGreaterThanOrEqual(8 - 1e-10)
  })

  it("maps a selection in a scaled plot to both measurement axes and restores the full view", async () => {
    const { plot, drag, domains } = await mountInteractivePlot()
    const initial = domains()
    await drag([267.5, 112], [674.5, 300])
    expect(domains()).toEqual({ x: [200, 600], y: [-45, -15] })
    await plot.trigger("dblclick")
    expect(domains()).toEqual(initial)
  })

  it("widens the view with a reverse selection and resets with the opposing diagonal", async () => {
    const { drag, domains } = await mountInteractivePlot()
    const initial = domains()
    await drag([674.5, 300], [267.5, 112])
    expect(domains()).toEqual({ x: [-600, 1000], y: [-75, 45] })
    await drag([267.5, 300], [674.5, 112])
    expect(domains()).toEqual(initial)
  })

  it("maps selections through logarithmic frequency spacing", async () => {
    const { plot, drag, domains } = await mountInteractivePlot()
    await plot.setProps({ logarithmic: true, xDomain: [20, 20000] })
    await drag([267.5, 112], [674.5, 300])
    expect(domains().x[0]).toBeCloseTo(20 * 1000 ** 0.25)
    expect(domains().x[1]).toBeCloseTo(20 * 1000 ** 0.75)
    expect(domains().y).toEqual([-45, -15])
    expect(option().xAxis.type).toBe("log")
  })

  it("pans the axis under the wheel and pans both axes inside the graph", async () => {
    const { wheel, domains } = await mountInteractivePlot()
    expect((await wheel(471, 420)).defaultPrevented).toBe(true)
    expect(domains()).toEqual({ x: [64, 864], y: [-60, 0] })
    await wheel(32, 206, { deltaY: -1 })
    expect(domains()).toEqual({ x: [64, 864], y: [-64.8, -4.8] })
    await wheel(471, 206)
    expect(domains()).toEqual({ x: [128, 928], y: [-60, 0] })
  })

  it("uses Ctrl or Meta wheel zoom on the indicated axis, leaving the other axis unchanged", async () => {
    const { wheel, domains } = await mountInteractivePlot()
    await wheel(471, 420, { ctrlKey: true, deltaY: -1 })
    expect(domains().x[0]).toBeCloseTo(400 - 400 / 1.15)
    expect(domains().x[1]).toBeCloseTo(400 + 400 / 1.15)
    expect(domains().y).toEqual([-60, 0])
    const x = domains().x
    await wheel(32, 206, { metaKey: true, deltaY: -1 })
    expect(domains().x).toEqual(x)
    expect(domains().y[0]).toBeCloseTo(-30 - 30 / 1.15)
    expect(domains().y[1]).toBeCloseTo(-30 + 30 / 1.15)
    const y = domains().y
    await wheel(471, 420, { ctrlKey: true })
    expect(domains().x[0]).toBeCloseTo(0)
    expect(domains().x[1]).toBeCloseTo(800)
    expect(domains().y).toEqual(y)
  })

  it("leaves the view unchanged for clicks, drags outside the graph, and cancelled selection", async () => {
    const { plot, drag, pointer, domains } = await mountInteractivePlot()
    const initial = domains()
    await drag([267.5, 112], [674.5, 300], 2)
    expect(domains()).toEqual(initial)
    await drag([32, 112], [674.5, 300])
    expect(domains()).toEqual(initial)
    await drag([267.5, 112], [270, 115])
    expect(domains()).toEqual(initial)
    await pointer("pointerdown", 267.5, 112)
    await pointer("pointermove", 674.5, 300)
    await plot.trigger("pointercancel", { pointerId: 1 })
    await pointer("pointerup", 674.5, 300)
    expect(domains()).toEqual(initial)
  })

  it("does not consume wheel input outside the axes or with no vertical movement", async () => {
    const { wheel, domains } = await mountInteractivePlot()
    const initial = domains()
    expect((await wheel(32, 420)).defaultPrevented).toBe(false)
    expect((await wheel(471, 206, { deltaY: 0 })).defaultPrevented).toBe(false)
    expect(domains()).toEqual(initial)
  })

  it("resets both axes when the requested measurement domain changes", async () => {
    const { plot, drag, domains } = await mountInteractivePlot()
    await drag([267.5, 112], [674.5, 300])
    await plot.setProps({ xDomain: [100, 1000], yDomain: [-120, 12] })
    expect(domains()).toEqual({ x: [100, 1000], y: [-120, 12] })
  })

  it("discards a linear pan when switching to a logarithmic frequency scale", async () => {
    const { plot, wheel, domains } = await mountInteractivePlot()
    await plot.setProps({ xDomain: [20, 20000] })
    await wheel(471, 420, { deltaY: -1 })
    expect(domains().x[0]).toBeLessThan(0)
    await plot.setProps({ logarithmic: true })
    expect(domains().x).toEqual([20, 20000])
  })

  it("preserves navigation across report refresh but restores auto bounds when measurement units change", async () => {
    const { plot, drag, domains } = await mountInteractivePlot()
    await plot.setProps({ yDomain: undefined, series: [{ label: "H2", x: [0, 800], y: [-60, 0] }] })
    await drag([267.5, 112], [674.5, 300])
    const zoomed = domains()
    await plot.setProps({ series: [{ label: "H2", x: [0, 800], y: [-50, -5] }] })
    expect(domains()).toEqual(zoomed)
    await plot.setProps({ yLabel: "%", series: [{ label: "H2", x: [0, 800], y: [0, 100] }] })
    expect(domains()).toEqual({ x: [0, 800], y: [-8, 108] })
  })
})
