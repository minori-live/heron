import { shallowMount, type VueWrapper } from "@vue/test-utils"
import { nextTick } from "vue"
import { describe, expect, it } from "vitest"
import { UiButton, UiCheckbox, UiNumberInput, UiSegmentedControl, UiSelect } from "@heron/ui"
import { analysisReport } from "../../test/plugin-analysis"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisLinear from "./PluginAnalysisLinear.vue"
import PluginAnalysisHarmonics from "./PluginAnalysisHarmonics.vue"
import PluginAnalysisModel from "./PluginAnalysisModel.vue"

// Shared UI owns gestures; these tests exercise the normalized control intents and
// the report-to-plot contract owned by the analysis presenters.
async function select(wrapper: VueWrapper, label: string, value: string) {
  const control = wrapper
    .findAllComponents(UiSegmentedControl)
    .find((item) => item.props("label") === label)
  if (!control) throw new Error(`Missing ${label} control`)
  control.vm.$emit("update:modelValue", value)
  await nextTick()
}

describe("linear analysis presentation", () => {
  it("selects direct and cross-channel paths with a magnitude domain containing the measurements", async () => {
    const wrapper = shallowMount(PluginAnalysisLinear, { props: { report: analysisReport() } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    expect(plot.props("series").map((series) => [series.label, series.y])).toEqual([
      ["L → L", [-12, 6]],
      ["R → R", [-3, 0]]
    ])
    expect(plot.props("yDomain")).toEqual([-12, 6])
    wrapper.getComponent(UiSelect).vm.$emit("update:modelValue", "2")
    await nextTick()
    expect(plot.props("series")).toMatchObject([{ label: "L → R", x: [100, 1000], y: [-60, -40] }])
    expect(plot.props("yDomain")).toEqual([-60, 6])
  })

  it("compensates measured delay in phase and time while retaining unavailable phase bins", async () => {
    const wrapper = shallowMount(PluginAnalysisLinear, { props: { report: analysisReport() } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    await select(wrapper, "Response view", "phase")
    expect(plot.props("series")[0]?.y).toEqual([0, null])
    wrapper.getComponent(UiCheckbox).vm.$emit("update:modelValue", true)
    await nextTick()
    expect(plot.props("series")[0]?.y).toEqual([36, null])
    expect(plot.props("series")[1]?.y).toEqual([-30, -60])
    expect(plot.props("yLabel")).toBe("°")
    await select(wrapper, "Response view", "impulse")
    expect(plot.props("series")[0]).toMatchObject({ x: [1, 2], y: [1, 0.5] })
    expect(plot.props("series")[1]?.x).toEqual([0, 0.5])
    expect(plot.props()).toMatchObject({ xLabel: "ms", logarithmic: false, yDomain: undefined })
    wrapper.getComponent(UiCheckbox).vm.$emit("update:modelValue", false)
    await nextTick()
    expect(plot.props("series")[0]?.x).toEqual([2, 3])
  })

  it("keeps a stored comparison across new reports and clears it when changing measurement units", async () => {
    const wrapper = shallowMount(PluginAnalysisLinear, { props: { report: analysisReport() } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    const [store, clear] = wrapper.findAllComponents(UiButton)
    expect(clear!.props("disabled")).toBe(true)
    store!.vm.$emit("click")
    const next = analysisReport()
    next.responses[0]!.magnitude_db = [-2, 1]
    await wrapper.setProps({ report: next })
    expect(plot.props("series")).toMatchObject([
      { label: "L → L · Stored", y: [-12, 6], dashed: true },
      { label: "R → R · Stored", y: [-3, 0], dashed: true },
      { label: "L → L", y: [-2, 1] },
      { label: "R → R", y: [-3, 0] }
    ])
    expect(clear!.props("disabled")).toBe(false)
    clear!.vm.$emit("click")
    await nextTick()
    expect(plot.props("series")).toHaveLength(2)
    store!.vm.$emit("click")
    await select(wrapper, "Response view", "phase")
    expect(plot.props("series").every((series) => !series.dashed)).toBe(true)
  })
})

describe("harmonic analysis presentation", () => {
  it("selects the independently measured sweep and exposes its time, frequency, and energy domains", async () => {
    const report = analysisReport()
    const wrapper = shallowMount(PluginAnalysisHarmonics, { props: { report } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    expect(plot.props()).toMatchObject({
      xLabel: "s",
      yLabel: "Hz",
      logarithmic: false,
      series: [],
      xDomain: [0, 1.25],
      yDomain: [0, 24000],
      heatmap: { columns: 2, rows: 2, values: [-120, -18, -12, -6] }
    })
    await select(wrapper, "Channel", "1")
    expect(plot.props("heatmap")).toBeUndefined()
    expect(plot.props("xDomain")).toEqual([0, report.settings.sweep_seconds])
    await select(wrapper, "Sweep", "linear")
    expect(plot.props("heatmap")?.values).toEqual([-100, -40, -30, -20])
    expect(plot.props("xDomain")).toEqual([0, 1.5])
    const [minimum, maximum] = wrapper.findAllComponents(UiNumberInput)
    minimum!.vm.$emit("update:modelValue", -80)
    maximum!.vm.$emit("update:modelValue", 0)
    await nextTick()
    expect(plot.props("colorDomain")).toEqual([-80, 0])
    expect(minimum!.props("max")).toBe(-1)
    expect(maximum!.props("min")).toBe(-79)
    minimum!.vm.$emit("update:modelValue", null)
    await nextTick()
    expect(plot.props("colorDomain")).toEqual([-80, 0])
  })

  it("converts harmonic dBc to percent without inventing unavailable bins and keeps THD in percent", async () => {
    const wrapper = shallowMount(PluginAnalysisHarmonics, { props: { report: analysisReport() } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    await select(wrapper, "Harmonic view", "1d")
    expect(plot.props()).toMatchObject({ yLabel: "dBc", logarithmic: true, heatmap: undefined })
    expect(plot.props("series")).toMatchObject([{ label: "H2", x: [100, 1000], y: [-20, null] }])
    wrapper.getComponent(UiSelect).vm.$emit("update:modelValue", "linear")
    await nextTick()
    expect(plot.props("series")[0]?.y).toEqual([10, null])
    expect(plot.props("yLabel")).toBe("%")
    await select(wrapper, "Channel", "1")
    expect(plot.props("series")[0]?.y).toEqual([1, null])
    await select(wrapper, "Frequency scale", "linear")
    expect(plot.props("logarithmic")).toBe(false)
    await select(wrapper, "Harmonic view", "thd")
    expect(plot.props("series")).toEqual([{ label: "R", x: [100, 1000], y: [1, null] }])
    expect(plot.props("yLabel")).toBe("%")
  })
})

describe("Hammerstein model presentation", () => {
  it("projects independent filter DC gains over the measured input scale and changes channel", async () => {
    const wrapper = shallowMount(PluginAnalysisModel, { props: { report: analysisReport() } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    const series = plot.props("series")[0]!
    expect([series.x[0], series.x[128], series.x.at(-1)]).toEqual([-0.5, 0, 0.5])
    expect([series.y[0], series.y[128], series.y.at(-1)]).toEqual([0, 0, 0])
    expect(wrapper.text()).toContain("Fit error: 0.25%")
    await select(wrapper, "Channel", "1")
    expect(plot.props("series")[0]?.y.at(-1)).toBe(1)
    expect(wrapper.text()).toContain("Fit error: 25.00%")
  })

  it("plots filter response and time series with the report sample rate and validation stride", async () => {
    const report = analysisReport()
    report.settings.end_hz = 12000
    const wrapper = shallowMount(PluginAnalysisModel, { props: { report } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    await select(wrapper, "Model view", "filter")
    expect(plot.props()).toMatchObject({ xLabel: "Hz", yLabel: "dB", logarithmic: true })
    expect(plot.props("series")[0]?.x.at(-1)).toBeCloseTo(12000)
    // H(z) = 1 - z^-1 has magnitude sqrt(2) at a quarter of the sample rate.
    expect(plot.props("series")[0]?.y.at(-1)).toBeCloseTo(3.0103, 4)
    await select(wrapper, "Model view", "impulse")
    expect(plot.props("series")).toEqual([{ label: "H", x: [0, 1000 / 48000], y: [1, -1] }])
    expect(plot.props("logarithmic")).toBe(false)
    await select(wrapper, "Model view", "validation")
    expect(plot.props("series")).toMatchObject([
      { label: "Measured", x: [0, 1], y: [0.21, 0.39] },
      { label: "Model", x: [0, 1], y: [0.2, 0.4], dashed: true }
    ])
    expect(plot.props("xLabel")).toBe("ms")
  })
})
