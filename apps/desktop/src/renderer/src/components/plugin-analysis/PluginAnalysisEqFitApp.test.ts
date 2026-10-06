import { createHead } from "@unhead/vue/client"
import { createPinia } from "pinia"
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HeronPluginAnalysisEqFitApi, PluginAnalysisEqFitSnapshot } from "@heron/contracts"
import { analysisReport, analysisSnapshot } from "../../test/plugin-analysis"
import { rpcFailure, rpcSuccess } from "../../test/ipc"
import { setAppLocale } from "../../i18n"
import AppTitleBar from "../application/AppTitleBar.vue"
import PluginAnalysisEqFitApp from "./PluginAnalysisEqFitApp.vue"
import PluginAnalysisEqFit from "./PluginAnalysisEqFit.vue"

const wrappers: VueWrapper[] = []
function snapshot(
  overrides: Partial<PluginAnalysisEqFitSnapshot> = {}
): PluginAnalysisEqFitSnapshot {
  return {
    ref: analysisSnapshot().ref,
    revision: 2,
    selectionRevision: 1,
    selection: { reportId: "report-1", reportRevision: 2, input: 0, output: 0, mode: "single" },
    reportId: "report-1",
    reportRevision: 2,
    report: analysisReport(),
    comparisonReport: null,
    locale: "en-US",
    theme: "dark",
    maximized: false,
    ...overrides
  }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  Reflect.deleteProperty(window, "heronPluginAnalysisEqFit")
  vi.useRealTimers()
  setAppLocale("en-US")
})
function setup() {
  const read = vi
    .fn<HeronPluginAnalysisEqFitApi["snapshot"]>()
    .mockResolvedValue(rpcSuccess(snapshot()))
  const command = vi
    .fn<HeronPluginAnalysisEqFitApi["window"]>()
    .mockResolvedValue(rpcSuccess({ maximized: true }))
  Object.defineProperty(window, "heronPluginAnalysisEqFit", {
    configurable: true,
    value: { platform: "win32", snapshot: read, window: command }
  })
  const wrapper = shallowMount(PluginAnalysisEqFitApp, {
    global: { plugins: [createPinia(), createHead()], renderStubDefaultSlot: true }
  })
  wrappers.push(wrapper)
  return { wrapper, read, command }
}
async function poll() {
  await vi.advanceTimersByTimeAsync(250)
  await flushPromises()
}

describe("independent EQ Fit renderer", () => {
  it("retains omitted stable report bodies and component state, but replaces a new report identity", async () => {
    const { wrapper, read } = setup()
    await flushPromises()
    const panel = wrapper.getComponent(PluginAnalysisEqFit)
    const original = panel.props("report")
    read.mockResolvedValue(rpcSuccess(snapshot({ report: null })))
    await poll()
    expect(read.mock.calls.at(-1)![1]).toBe("report-1")
    expect(wrapper.getComponent(PluginAnalysisEqFit).vm).toBe(panel.vm)
    expect(panel.props("report")).toBe(original)
    const next = snapshot({
      reportId: "report-2",
      selectionRevision: 2,
      selection: { ...snapshot().selection!, reportId: "report-2" }
    })
    next.report!.responses[0]!.magnitude_db = [1, 2]
    read.mockResolvedValue(rpcSuccess(next))
    await poll()
    expect(panel.props("reportId")).toBe("report-2")
    expect(panel.props("report").responses[0]!.magnitude_db).toEqual([1, 2])
  })

  it("unmounts the fitter for L+R, stale contexts, and failed reads; reconnect needs fresh report bodies", async () => {
    const { wrapper, read } = setup()
    await flushPromises()
    // Null context must invalidate even if a response reuses the old report ID.
    read.mockResolvedValue(rpcSuccess(snapshot({ selection: null, report: null })))
    await poll()
    expect(wrapper.findComponent(PluginAnalysisEqFit).exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toContain("Choose a single path")
    read.mockResolvedValue(rpcSuccess(snapshot({ revision: 3 })))
    await poll()
    expect(wrapper.findComponent(PluginAnalysisEqFit).exists()).toBe(false)
    read.mockResolvedValue(rpcSuccess(snapshot()))
    await poll()
    expect(wrapper.findComponent(PluginAnalysisEqFit).exists()).toBe(true)
    read.mockResolvedValue(rpcFailure("disconnected"))
    await poll()
    expect(wrapper.findComponent(PluginAnalysisEqFit).exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain("Fitting has stopped")
    read.mockResolvedValue(rpcSuccess(snapshot()))
    await poll()
    expect(read.mock.calls.at(-1)![1]).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findComponent(PluginAnalysisEqFit).exists()).toBe(true)
  })

  it("ignores pending reads after closing and reopens with fresh renderer state", async () => {
    const { wrapper, read } = setup()
    await flushPromises()
    let finish!: (value: Awaited<ReturnType<HeronPluginAnalysisEqFitApi["snapshot"]>>) => void
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await poll()
    wrapper.unmount()
    const count = read.mock.calls.length
    finish(rpcSuccess(snapshot({ reportId: "old-late" })))
    await poll()
    expect(read).toHaveBeenCalledTimes(count)
    const reopened = setup()
    await flushPromises()
    expect(reopened.read.mock.calls[0]![1]).toBeUndefined()
    expect(reopened.wrapper.getComponent(PluginAnalysisEqFit).props("reportId")).toBe("report-1")
  })

  it("sends explicit native maximize states and acknowledges successful window operations", async () => {
    const { wrapper, read, command } = setup()
    await flushPromises()
    const titlebar = wrapper.getComponent(AppTitleBar)
    titlebar.vm.$emit("windowCommand", "window.toggle-maximize")
    await flushPromises()
    const [meta, action] = command.mock.calls[0]!
    expect(action).toEqual({ type: "set-maximized", maximized: true })
    expect(meta.target).toEqual(snapshot().ref)
    command.mockResolvedValue(rpcSuccess({ maximized: false }))
    titlebar.vm.$emit("windowCommand", "window.toggle-maximize")
    await flushPromises()
    expect(command.mock.calls[1]![1]).toEqual({ type: "set-maximized", maximized: false })
    await poll()
    expect(read.mock.calls.at(-1)![2]).toBe(meta.mutation!.operationId)
    read.mockResolvedValueOnce(rpcFailure("interrupted"))
    await poll()
    const secondOperation = command.mock.calls[1]![0].mutation!.operationId
    expect(read.mock.calls.at(-1)![2]).toBe(secondOperation)
    await poll()
    expect(read.mock.calls.at(-1)![0].target).toEqual(snapshot().ref)
    expect(read.mock.calls.at(-1)![2]).toBe(secondOperation)
    await poll()
    expect(read.mock.calls.at(-1)![2]).toBeUndefined()
    command.mockResolvedValueOnce(rpcFailure("native-window-unavailable"))
    titlebar.vm.$emit("windowCommand", "window.minimize")
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain("window action")
    expect(wrapper.findComponent(PluginAnalysisEqFit).exists()).toBe(true)
  })
})
