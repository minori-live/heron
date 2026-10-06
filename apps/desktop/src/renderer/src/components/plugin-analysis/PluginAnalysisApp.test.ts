import { createTestingPinia } from "@pinia/testing"
import { createHead } from "@unhead/vue/client"
import { shallowMount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UiButton, UiCheckbox, UiIconButton, UiSlider } from "@heron/ui"
import type { PluginAnalysisSnapshot } from "@heron/contracts"
import { usePluginAnalysisStore } from "../../stores/pluginAnalysis"
import { analysisSnapshot } from "../../test/plugin-analysis"
import { setAppLocale } from "../../i18n"
import { rpcSuccess } from "../../test/ipc"
import AppTitleBar from "../application/AppTitleBar.vue"
import PluginAnalysisApp from "./PluginAnalysisApp.vue"
import PluginAnalysisChain from "./PluginAnalysisChain.vue"
import PluginAnalysisSettings from "./PluginAnalysisSettings.vue"

beforeEach(() => {
  Object.defineProperty(window, "heronPluginAnalysis", {
    configurable: true,
    value: {
      platform: "win32",
      setEqFitSelection: vi.fn(async (_meta, request) =>
        rpcSuccess({ sequence: request.sequence, selectionRevision: 1, opened: request.open })
      )
    }
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, "heronPluginAnalysis")
  setAppLocale("en-US")
})

function mountApp(snapshot: PluginAnalysisSnapshot | null = analysisSnapshot()) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const store = usePluginAnalysisStore(pinia)
  store.snapshot = snapshot
  const wrapper = shallowMount(PluginAnalysisApp, {
    global: {
      plugins: [pinia, createHead()],
      renderStubDefaultSlot: true,
      stubs: { UiPopover: { template: '<section><slot name="trigger" /><slot /></section>' } }
    }
  })
  return { wrapper, store }
}

describe("analysis window orchestration", () => {
  it("starts and stops polling with the view, showing loading until a snapshot arrives", async () => {
    const { wrapper, store } = mountApp(null)
    expect(wrapper.get('[role="status"]').text()).toBe("Opening Plugin Analysis…")
    expect(store.start).toHaveBeenCalledOnce()
    store.snapshot = analysisSnapshot()
    await nextTick()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.text()).toContain("48 kHz · 256 samples")
    expect(wrapper.getComponent(AppTitleBar).props()).toMatchObject({
      platform: "win32",
      projectName: "Plugin Analysis",
      dirty: false
    })
    wrapper.unmount()
    expect(store.stop).toHaveBeenCalledOnce()
  })

  it("commits level changes, analysis controls, chain intents and window actions through the store", async () => {
    const { wrapper, store } = mountApp(analysisSnapshot({ status: "running" }))
    const slider = wrapper.getComponent(UiSlider)
    slider.vm.$emit("update:modelValue", 6)
    await nextTick()
    expect(store.configure).not.toHaveBeenCalled()
    expect(wrapper.get("output").text()).toBe("+6.0 dBFS")
    slider.vm.$emit("change", 6)
    wrapper
      .findAllComponents(UiCheckbox)
      .find((c) => c.props("label") === "Auto analyze")!
      .vm.$emit("update:modelValue", false)
    const buttons = wrapper.findAllComponents(UiButton)
    buttons.find((button) => button.text() === "Cancel")!.vm.$emit("click")
    buttons.find((button) => button.text() === "Analyze")!.vm.$emit("click")
    wrapper.getComponent(PluginAnalysisSettings).vm.$emit("configure", { block_size: 512 })
    wrapper
      .getComponent(PluginAnalysisChain)
      .vm.$emit("command", { type: "remove", instanceId: "effect" })
    const titlebar = wrapper.getComponent(AppTitleBar)
    titlebar.vm.$emit("windowCommand", "window.minimize")
    titlebar.vm.$emit("windowCommand", "window.toggle-maximize")
    titlebar.vm.$emit("windowCommand", "window.close")
    expect(store.configure).toHaveBeenNthCalledWith(1, { level_dbfs: 6 })
    expect(store.configure).toHaveBeenNthCalledWith(2, { block_size: 512 })
    expect(vi.mocked(store.command).mock.calls.map(([command]) => command)).toEqual([
      { type: "automatic", enabled: false },
      { type: "cancel" },
      { type: "analyze" },
      { type: "remove", instanceId: "effect" },
      { type: "window", action: "minimize" },
      { type: "window", action: "maximize" },
      { type: "window", action: "close" }
    ])
    wrapper.unmount()
  })

  it("preserves stale results and recovery errors while quarantining measurement controls", async () => {
    const { wrapper, store } = mountApp(
      analysisSnapshot({ revision: 4, status: "quarantined", failure: "cleanup-failed" })
    )
    expect(wrapper.text()).toContain("Results are out of date.")
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Analysis stopped. Restart Heron to continue."
    )
    expect(wrapper.get("footer").attributes("inert")).toBeDefined()
    expect(wrapper.getComponent(UiIconButton).props("disabled")).toBe(true)
    expect(wrapper.findAllComponents(UiButton).some((button) => button.text() === "Cancel")).toBe(
      false
    )
    store.error = "Cannot reach the analysis window."
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toBe(store.error)
    store.error = ""
    store.snapshot = analysisSnapshot({ status: "debouncing" })
    await nextTick()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain("Results are out of date.")
    expect(wrapper.get("footer").attributes("inert")).toBeUndefined()
    expect(wrapper.getComponent(UiIconButton).props("disabled")).toBe(false)
    expect(wrapper.findAllComponents(UiButton).some((button) => button.text() === "Cancel")).toBe(
      true
    )
    wrapper.unmount()
  })
})
