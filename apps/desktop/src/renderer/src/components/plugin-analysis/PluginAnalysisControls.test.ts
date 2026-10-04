import { shallowMount } from "@vue/test-utils"
import { nextTick } from "vue"
import { describe, expect, it } from "vitest"
import {
  UiAnalysisPlot,
  UiField,
  UiIconButton,
  UiNumberInput,
  UiProgress,
  UiSelect,
  UiSegmentedControl,
  UiTabs
} from "@heron/ui"
import {
  DEFAULT_PLUGIN_ANALYSIS_SETTINGS,
  pluginDescriptorKey,
  validPluginAnalysisSettings
} from "@heron/contracts"
import type { PluginDescriptor } from "@heron/contracts"
import { analysisReport, analysisSnapshot } from "../../test/plugin-analysis"
import MixerPluginSection from "../mixer/MixerPluginSection.vue"
import PluginAnalysisChain from "./PluginAnalysisChain.vue"
import PluginAnalysisSettings from "./PluginAnalysisSettings.vue"
import PluginAnalysisPerformance from "./PluginAnalysisPerformance.vue"
import PluginAnalysisReport from "./PluginAnalysisReport.vue"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"
import PluginAnalysisLinear from "./PluginAnalysisLinear.vue"
import PluginAnalysisHarmonics from "./PluginAnalysisHarmonics.vue"
import PluginAnalysisModel from "./PluginAnalysisModel.vue"

describe("analysis measurement settings", () => {
  it("caps the sweep when lowering sample rate and emits numeric configuration patches", async () => {
    const wrapper = shallowMount(PluginAnalysisSettings, {
      props: {
        settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, sample_rate: 96000, end_hz: 40000 }
      },
      global: { stubs: { UiField: false } }
    })
    const rate = wrapper.findAllComponents(UiSelect).find((c) => c.props("modelValue") === "96000")!
    const block = wrapper.findAllComponents(UiSelect).find((c) => c.props("modelValue") === "256")!
    rate.vm.$emit("update:modelValue", "44100")
    block.vm.$emit("update:modelValue", "512")
    const numbers = wrapper.findAllComponents(UiNumberInput)
    const patches = [100, 18000, 2, 1, 1000, 7]
    for (const [index, input] of numbers.entries())
      input.vm.$emit("update:modelValue", patches[index])
    numbers[0]!.vm.$emit("update:modelValue", null)
    expect(wrapper.emitted("configure")).toEqual([
      [{ sample_rate: 44100, start_hz: 20, end_hz: 19845, tone_hz: 1000 }],
      [{ block_size: 512 }],
      [{ start_hz: 100 }],
      [{ end_hz: 18000 }],
      [{ sweep_seconds: 2 }],
      [{ tail_seconds: 1 }],
      [{ tone_hz: 1000 }],
      [{ model_order: 7 }]
    ])
    await wrapper.setProps({
      settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, end_hz: 18000, start_hz: 100 }
    })
    expect(numbers[0]!.props("max")).toBe(8999)
    expect(numbers[1]!.props()).toMatchObject({ min: 201, max: 21600 })
    rate.vm.$emit("update:modelValue", "96000")
    expect(wrapper.emitted("configure")?.at(-1)).toEqual([
      { sample_rate: 96000, start_hz: 100, end_hz: 18000, tone_hz: 1000 }
    ])
    expect(wrapper.findAllComponents(UiField).map((field) => field.props("label"))).toContain(
      "Settle / tail duration"
    )
  })

  it("keeps high tone and sweep frequencies valid when reducing the sample rate", () => {
    const settings = {
      ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS,
      sample_rate: 96000,
      start_hz: 20000,
      end_hz: 42000,
      tone_hz: 40000
    }
    const wrapper = shallowMount(PluginAnalysisSettings, {
      props: { settings },
      global: { stubs: { UiField: false } }
    })
    const rate = wrapper.findAllComponents(UiSelect).find((c) => c.props("modelValue") === "96000")!
    rate.vm.$emit("update:modelValue", "44100")

    const patch = wrapper.emitted("configure")?.[0]?.[0]
    expect(patch).toEqual({ sample_rate: 44100, start_hz: 9921.5, end_hz: 19845, tone_hz: 19845 })
    expect(validPluginAnalysisSettings({ ...settings, ...(patch as object) })).toBe(true)
  })

  it("preserves a valid narrow low-frequency sweep when changing sample rate", () => {
    const settings = { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, start_hz: 10, end_hz: 21 }
    const wrapper = shallowMount(PluginAnalysisSettings, {
      props: { settings },
      global: { stubs: { UiField: false } }
    })
    const rate = wrapper.findAllComponents(UiSelect).find((c) => c.props("modelValue") === "48000")!
    rate.vm.$emit("update:modelValue", "44100")

    const patch = wrapper.emitted("configure")?.[0]?.[0]
    expect(patch).toEqual({ sample_rate: 44100, start_hz: 10, end_hz: 21, tone_hz: 1000 })
    expect(validPluginAnalysisSettings({ ...settings, ...(patch as object) })).toBe(true)
  })
})

describe("analysis chain intents", () => {
  it("maps rack actions and blocks structural edits while scanning or quarantined", async () => {
    const wrapper = shallowMount(PluginAnalysisChain, {
      props: { snapshot: analysisSnapshot(), catalogBusy: false, chain: 0 }
    })
    const rack = wrapper.getComponent(MixerPluginSection)
    expect(rack.props()).toMatchObject({
      structureEnabled: true,
      editorsEnabled: true,
      slotRows: 6
    })
    const descriptor: PluginDescriptor = {
      source: { kind: "external" },
      locator: { format: "vst3", artifactPath: "/effect.vst3", nativeId: "effect" },
      name: "Effect",
      vendor: "Heron",
      version: "1",
      categories: ["Fx"],
      kind: "effect",
      supportedAudioModes: ["stereo"],
      architecture: "x86_64",
      buses: [],
      hasEditor: true,
      compatibility: "compatible",
      compatibilityReason: null
    }
    rack.vm.$emit("insert", { descriptor, audioMode: "stereo" }, 2)
    rack.vm.$emit("open", "instance")
    rack.vm.$emit("toggle", "instance", false)
    rack.vm.$emit("move", "instance", 0)
    rack.vm.$emit("remove", "instance")
    wrapper.getComponent(UiIconButton).vm.$emit("click")
    expect(wrapper.emitted("command")).toEqual([
      [
        {
          type: "insert",
          chain: 0,
          pluginKey: pluginDescriptorKey(descriptor),
          audioMode: "stereo",
          slotOrder: 2
        }
      ],
      [{ type: "editor", instanceId: "instance" }],
      [{ type: "toggle", instanceId: "instance", enabled: false }],
      [{ type: "move", instanceId: "instance", slotOrder: 0 }],
      [{ type: "remove", instanceId: "instance" }],
      [{ type: "refresh-catalog" }]
    ])
    await wrapper.setProps({ catalogBusy: true })
    expect(rack.props()).toMatchObject({ structureEnabled: false, editorsEnabled: true })
    expect(wrapper.getComponent(UiIconButton).props()).toMatchObject({
      disabled: true,
      loading: true
    })
    await wrapper.setProps({
      catalogBusy: false,
      snapshot: analysisSnapshot({ status: "quarantined" })
    })
    expect(rack.props()).toMatchObject({ structureEnabled: false, editorsEnabled: false })
    expect(wrapper.getComponent(UiIconButton).props("disabled")).toBe(true)
  })
})

describe("analysis report composition", () => {
  it("routes parallel, individual and difference reports with a literal comparison label", async () => {
    const snapshot = analysisSnapshot({
      comparisonEnabled: true,
      comparisonReport: analysisReport(),
      differenceReport: analysisReport()
    })
    snapshot.comparisonReport!.settings.level_dbfs = -12
    snapshot.differenceReport!.settings.level_dbfs = -24
    const wrapper = shallowMount(PluginAnalysisReport, {
      props: { snapshot },
      global: {
        stubs: {
          UiTabs: {
            props: ["modelValue"],
            template: '<section><slot :name="modelValue" /></section>'
          }
        }
      }
    })
    const selector = wrapper.getComponent(UiSegmentedControl)
    expect(selector.props("options")[0]?.label).toBe("1 | 2")
    const linear = wrapper.getComponent(PluginAnalysisLinear)
    expect(linear.props("comparison")).toEqual(snapshot.comparisonReport)
    for (const [mode, report] of [
      ["difference", snapshot.differenceReport],
      ["comparison", snapshot.comparisonReport],
      ["primary", snapshot.report]
    ] as const) {
      selector.vm.$emit("update:modelValue", mode)
      await nextTick()
      expect(linear.props("report")).toEqual(report)
      expect(linear.props("comparison")).toBeUndefined()
    }
  })

  it("labels current and stored traces and passes measurement units to the shared plot", () => {
    const series = [
      { label: "L → L", x: [100, 1000], y: [-12, 6] },
      { label: "L → L · Stored", x: [100, 1000], y: [-3, 0], dashed: true }
    ]
    const wrapper = shallowMount(PluginAnalysisPlot, {
      props: {
        title: "Frequency response",
        xLabel: "Hz",
        yLabel: "dB",
        series,
        logarithmic: true,
        yDomain: [-12, 6]
      }
    })
    expect(wrapper.get("figcaption").text()).toContain("Frequency response")
    expect(wrapper.get("figcaption").text()).toContain("L → L · Stored")
    expect(wrapper.getComponent(UiAnalysisPlot).props()).toMatchObject({
      label: "Frequency response",
      xLabel: "Hz",
      yLabel: "dB",
      series,
      logarithmic: true,
      yDomain: [-12, 6]
    })
  })

  it("shows empty measurement domains, then routes each tab to the completed report", async () => {
    const wrapper = shallowMount(PluginAnalysisReport, {
      props: { snapshot: analysisSnapshot({ report: null }) },
      global: {
        stubs: {
          UiTabs: {
            props: ["modelValue", "items", "label"],
            template: '<section><slot :name="modelValue" /></section>'
          }
        }
      }
    })
    const tabs = wrapper.getComponent(UiTabs)
    expect(wrapper.getComponent(PluginAnalysisPlot).props()).toMatchObject({
      xLabel: "Hz",
      yDomain: [-6, 6],
      series: []
    })
    tabs.vm.$emit("update:modelValue", "harmonics")
    await nextTick()
    expect(wrapper.getComponent(PluginAnalysisPlot).props()).toMatchObject({
      xDomain: [0, 1],
      yDomain: [0, 24000]
    })
    tabs.vm.$emit("update:modelValue", "model")
    await nextTick()
    expect(wrapper.getComponent(PluginAnalysisPlot).props()).toMatchObject({
      xDomain: [-1, 1],
      yDomain: [-1, 1]
    })
    tabs.vm.$emit("update:modelValue", "performance")
    await nextTick()
    expect(wrapper.findComponent(PluginAnalysisPerformance).exists()).toBe(false)
    const snapshot = analysisSnapshot()
    await wrapper.setProps({ snapshot })
    expect(wrapper.getComponent(PluginAnalysisPerformance).props("snapshot")).toEqual(snapshot)
    for (const [tab, component] of [
      ["linear", PluginAnalysisLinear],
      ["harmonics", PluginAnalysisHarmonics],
      ["model", PluginAnalysisModel]
    ] as const) {
      tabs.vm.$emit("update:modelValue", tab)
      await nextTick()
      expect(wrapper.getComponent(component).props("report")).toEqual(snapshot.report)
    }
  })

  it("reports latency, deadline utilization, and memory deltas in readable units", async () => {
    const snapshot = analysisSnapshot({
      memory: {
        baselineBytes: 1048576,
        loadedBytes: 3145728,
        peakBytes: 5242880,
        releasedBytes: 1572864
      }
    })
    const wrapper = shallowMount(PluginAnalysisPerformance, { props: { snapshot } })
    expect(wrapper.getComponent(UiProgress).props("value")).toBe(40)
    const text = wrapper.text().replace(/\s+/g, " ")
    expect(text).toContain("1.000 ms")
    expect(text).toContain("48 samples")
    expect(text).toContain("2 / 100")
    expect(text).toContain("2.00 MiB")
    expect(text).toContain("4.00 MiB")
    expect(text).toContain("0.50 MiB")
    await wrapper.setProps({ snapshot: analysisSnapshot({ report: analysisReport() }) })
    expect(wrapper.text()).not.toContain("Memory change after loading")
    expect(wrapper.text()).toContain("Estimated analysis memory")
  })
})
