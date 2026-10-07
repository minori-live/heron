import { shallowMount } from "@vue/test-utils"
import { nextTick } from "vue"
import { describe, expect, it } from "vitest"
import { UiButton, UiCheckbox, UiIconButton, UiProgress, UiSlider } from "@heron/ui"
import type { PluginAnalysisSnapshot } from "@heron/contracts"
import { analysisSnapshot } from "../../test/plugin-analysis"
import PluginAnalysisCommandBar from "./PluginAnalysisCommandBar.vue"

function mountBar(snapshot: PluginAnalysisSnapshot = analysisSnapshot()) {
  return shallowMount(PluginAnalysisCommandBar, {
    props: { snapshot, settingsOpen: false },
    global: { renderStubDefaultSlot: true }
  })
}

const button = (wrapper: ReturnType<typeof mountBar>, text: string) =>
  wrapper.findAllComponents(UiButton).find((b) => b.text() === text)

describe("analysis command bar", () => {
  it("commits the input level on release and emits run and settings intents", async () => {
    const wrapper = mountBar(analysisSnapshot({ status: "running" }))
    const slider = wrapper.getComponent(UiSlider)
    slider.vm.$emit("update:modelValue", 6)
    await nextTick()
    expect(wrapper.emitted("configure")).toBeUndefined()
    expect(wrapper.get("output").text()).toBe("+6.0 dBFS")
    slider.vm.$emit("change", 6)
    wrapper
      .findAllComponents(UiCheckbox)
      .find((c) => c.props("label") === "Auto analyze")!
      .vm.$emit("update:modelValue", false)
    button(wrapper, "Cancel")!.vm.$emit("click")
    button(wrapper, "Analyze")!.vm.$emit("click")
    wrapper.getComponent(UiIconButton).vm.$emit("click")
    expect(wrapper.emitted("configure")).toEqual([[{ level_dbfs: 6 }]])
    expect(wrapper.emitted("command")).toEqual([
      [{ type: "automatic", enabled: false }],
      [{ type: "cancel" }],
      [{ type: "analyze" }]
    ])
    expect(wrapper.emitted("toggle-settings")).toHaveLength(1)
  })

  it("names the run state, phase and progress, and reports stale results", async () => {
    const wrapper = mountBar(
      analysisSnapshot({ status: "running", phase: "harmonics", progress: 0.424 })
    )
    expect(wrapper.get('[role="status"]').text()).toBe("Measuring · Harmonics")
    expect(wrapper.getComponent(UiProgress).props()).toMatchObject({ value: 42, valueText: "42%" })
    expect(wrapper.text()).toContain("48 kHz · 256 samples")
    await wrapper.setProps({ snapshot: analysisSnapshot() })
    expect(wrapper.get('[role="status"]').text()).toBe("Up to date")
    expect(wrapper.findComponent(UiProgress).exists()).toBe(false)
    expect(button(wrapper, "Cancel")).toBeUndefined()
    await wrapper.setProps({ snapshot: analysisSnapshot({ revision: 4 }) })
    expect(wrapper.get('[role="status"]').text()).toBe("Results are out of date.")
    await wrapper.setProps({ snapshot: analysisSnapshot({ report: null, status: "idle" }) })
    expect(wrapper.get('[role="status"]').text()).toBe("No results")
  })

  it("keeps status visible but inerts measurement controls while quarantined", () => {
    const wrapper = mountBar(analysisSnapshot({ status: "quarantined" }))
    expect(wrapper.get('[role="status"]').text()).toBe("Stopped")
    expect(wrapper.get(".run").attributes("inert")).toBeDefined()
    expect(wrapper.get(".signal").attributes("inert")).toBeDefined()
    expect(wrapper.getComponent(UiIconButton).props("disabled")).toBe(true)
  })
})
