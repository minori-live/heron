import { config, shallowMount, type VueWrapper } from "@vue/test-utils"
import { nextTick } from "vue"
import { describe, expect, it } from "vitest"
import { UiNumberInput, UiSegmentedControl } from "@heron/ui"
import { analysisReport } from "../../test/plugin-analysis"
import PluginAnalysisOscilloscope from "./PluginAnalysisOscilloscope.vue"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"

// View-control bars and readout strips are layout wrappers; render their slotted content.
config.global.stubs = {
  ...config.global.stubs,
  PluginAnalysisViewControls: false,
  PluginAnalysisReadouts: false
}

function report() {
  const value = analysisReport()
  value.oscilloscopes = [
    {
      channel: 0,
      sample_rate: 48000,
      sample_stride: 4,
      duration_seconds: 20 / 48000,
      delay_samples: 4,
      waveforms: [
        { waveform: "sine", input: [0, 0.25, 0.5, 0.75, 1], output: [-0.25, 0, 0.25, 0.5, 0.75] }
      ]
    }
  ]
  return value
}

async function select(wrapper: VueWrapper, value: string) {
  const control = wrapper
    .findAllComponents(UiSegmentedControl)
    .find((item) =>
      item.props("options").some((option: { value: string }) => option.value === value)
    )!
  control.vm.$emit("update:modelValue", value)
  await nextTick()
}

describe("oscilloscope sample coordinates", () => {
  it("uses each report's retained sample spacing and delay for comparison traces", async () => {
    const comparison = report()
    comparison.oscilloscopes[0]!.sample_rate = 96000
    comparison.oscilloscopes[0]!.sample_stride = 2
    comparison.oscilloscopes[0]!.delay_samples = 2
    comparison.oscilloscopes[0]!.waveforms[0]!.output = [-0.5, 0, 0.5, 1, 1.5]
    const wrapper = shallowMount(PluginAnalysisOscilloscope, {
      props: { report: report(), comparison }
    })
    const plot = wrapper.getComponent(PluginAnalysisPlot)

    const timeSeries = plot.props("series")
    expect(timeSeries[0]?.x).toEqual([0, 4, 8, 12, 16].map((sample) => (sample * 1000) / 48000))
    expect(timeSeries[2]?.x).toEqual([0, 2, 4, 6, 8].map((sample) => (sample * 1000) / 96000))
    await select(wrapper, "waveshaping")
    expect(plot.props("series")).toMatchObject([
      { x: [0, 0.25, 0.5, 0.75], y: [0, 0.25, 0.5, 0.75] },
      { label: "Chain 2", x: [0, 0.25, 0.5, 0.75], y: [0, 0.5, 1, 1.5] }
    ])
    expect(plot.props("xLabel")).toBe("Input")
  })

  it("interpolates manual audio-sample delays and never invents output beyond the capture", async () => {
    const wrapper = shallowMount(PluginAnalysisOscilloscope, { props: { report: report() } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    await select(wrapper, "waveshaping")
    const delay = wrapper.getComponent(UiNumberInput)
    delay.vm.$emit("update:modelValue", 6)
    await nextTick()
    expect(plot.props("series")[0]).toMatchObject({ x: [0, 0.25, 0.5], y: [0.125, 0.375, 0.625] })
    delay.vm.$emit("update:modelValue", 20)
    await nextTick()
    expect(plot.props("series")[0]).toMatchObject({ x: [], y: [] })
    delay.vm.$emit("update:modelValue", null)
    await nextTick()
    expect(plot.props("series")[0]?.y).toEqual([0, 0.25, 0.5, 0.75])
  })

  it("clears traces for unavailable channels and waveforms", async () => {
    const wrapper = shallowMount(PluginAnalysisOscilloscope, { props: { report: report() } })
    const plot = wrapper.getComponent(PluginAnalysisPlot)
    await select(wrapper, "square")
    expect(plot.props("series")).toEqual([])
    await select(wrapper, "sine")
    await select(wrapper, "1")
    expect(plot.props("series")).toEqual([])
  })
})
