import { createTestingPinia } from "@pinia/testing"
import { createHead } from "@unhead/vue/client"
import { shallowMount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UiIconButton } from "@heron/ui"
import type { PluginAnalysisSnapshot } from "@heron/contracts"
import { usePluginAnalysisStore } from "../../stores/pluginAnalysis"
import { analysisSnapshot } from "../../test/plugin-analysis"
import { setAppLocale } from "../../i18n"
import { rpcSuccess } from "../../test/ipc"
import AppTitleBar from "../application/AppTitleBar.vue"
import PluginAnalysisApp from "./PluginAnalysisApp.vue"
import PluginAnalysisChain from "./PluginAnalysisChain.vue"
import PluginAnalysisCommandBar from "./PluginAnalysisCommandBar.vue"
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
    global: { plugins: [pinia, createHead()], renderStubDefaultSlot: true }
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
    expect(wrapper.text()).not.toContain("Opening Plugin Analysis…")
    expect(wrapper.getComponent(PluginAnalysisCommandBar).props("snapshot")).toEqual(store.snapshot)
    expect(wrapper.getComponent(AppTitleBar).props()).toMatchObject({
      platform: "win32",
      projectName: "Plugin Analysis",
      dirty: false
    })
    wrapper.unmount()
    expect(store.stop).toHaveBeenCalledOnce()
  })

  it("routes command bar, settings, chain and window intents through the store", async () => {
    const { wrapper, store } = mountApp()
    const bar = wrapper.getComponent(PluginAnalysisCommandBar)
    expect(wrapper.findComponent(PluginAnalysisSettings).exists()).toBe(false)
    bar.vm.$emit("toggle-settings")
    await nextTick()
    expect(bar.props("settingsOpen")).toBe(true)
    bar.vm.$emit("configure", { level_dbfs: 6 })
    bar.vm.$emit("command", { type: "analyze" })
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
      { type: "analyze" },
      { type: "remove", instanceId: "effect" },
      { type: "window", action: "minimize" },
      { type: "window", action: "maximize" },
      { type: "window", action: "close" }
    ])
    wrapper
      .findAllComponents(UiIconButton)
      .find((button) => button.props("label") === "Close measurement settings")!
      .vm.$emit("click")
    await nextTick()
    expect(wrapper.findComponent(PluginAnalysisSettings).exists()).toBe(false)
    expect(bar.props("settingsOpen")).toBe(false)
    wrapper.unmount()
  })

  it("shows recovery errors and closes settings while quarantined", async () => {
    const { wrapper, store } = mountApp()
    wrapper.getComponent(PluginAnalysisCommandBar).vm.$emit("toggle-settings")
    store.snapshot = analysisSnapshot({ status: "quarantined", failure: "cleanup-failed" })
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Analysis stopped. Restart Heron to continue."
    )
    expect(wrapper.findComponent(PluginAnalysisSettings).exists()).toBe(false)
    store.error = "Cannot reach the analysis window."
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toBe(store.error)
    store.error = ""
    store.snapshot = analysisSnapshot()
    await nextTick()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
