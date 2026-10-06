import { createPinia, disposePinia } from "pinia"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HeronPluginAnalysisEqFitApi, PluginAnalysisEqFitSnapshot } from "@heron/contracts"
import { analysisReport, analysisSnapshot } from "../test/plugin-analysis"
import { rpcSuccess } from "../test/ipc"
import { usePluginAnalysisEqFitStore } from "./pluginAnalysisEqFit"

const piniaInstances: ReturnType<typeof createPinia>[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  piniaInstances.splice(0).forEach(disposePinia)
  Reflect.deleteProperty(window, "heronPluginAnalysisEqFit")
  vi.useRealTimers()
})
function snapshot(reportId = "report-1"): PluginAnalysisEqFitSnapshot {
  return {
    ref: analysisSnapshot().ref,
    revision: 2,
    selectionRevision: 1,
    selection: { reportId, reportRevision: 2, input: 0, output: 0, mode: "single" },
    reportId,
    reportRevision: 2,
    report: analysisReport(),
    comparisonReport: null,
    locale: "en-US",
    theme: "dark",
    maximized: false
  }
}
function setup() {
  const read = vi
    .fn<HeronPluginAnalysisEqFitApi["snapshot"]>()
    .mockResolvedValue(rpcSuccess(snapshot()))
  const command = vi
    .fn<HeronPluginAnalysisEqFitApi["window"]>()
    .mockResolvedValue(rpcSuccess({ maximized: false }))
  Object.defineProperty(window, "heronPluginAnalysisEqFit", {
    configurable: true,
    value: { platform: "win32", snapshot: read, window: command }
  })
  const pinia = createPinia()
  piniaInstances.push(pinia)
  const store = usePluginAnalysisEqFitStore(pinia)
  return { store, read, command }
}

describe("EQ Fit native store scope ownership", () => {
  it("restarts polling with fresh report bodies and ignores an old read without unlocking a newer read", async () => {
    const { store, read } = setup()
    let finishOld!: (value: Awaited<ReturnType<HeronPluginAnalysisEqFitApi["snapshot"]>>) => void
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve
        })
    )
    store.start()
    store.start()
    expect(read).toHaveBeenCalledOnce()
    store.stop()
    let finishNew!: (value: Awaited<ReturnType<HeronPluginAnalysisEqFitApi["snapshot"]>>) => void
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve
        })
    )
    store.start()
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1]![1]).toBeUndefined()
    finishOld(rpcSuccess(snapshot("old-report")))
    await flushPromises()
    expect(store.snapshot).toBeNull()
    await vi.advanceTimersByTimeAsync(250)
    expect(read).toHaveBeenCalledTimes(2)
    finishNew(rpcSuccess(snapshot("new-report")))
    await flushPromises()
    expect(store.snapshot?.reportId).toBe("new-report")
    await vi.advanceTimersByTimeAsync(250)
    expect(read).toHaveBeenCalledTimes(3)
    store.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it("acknowledges a late successful command after remount, drops the old queue, and guards new UI state", async () => {
    const { store, read, command } = setup()
    store.start()
    await flushPromises()
    let finish!: (value: Awaited<ReturnType<HeronPluginAnalysisEqFitApi["window"]>>) => void
    command.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    store.windowCommand("window.toggle-maximize")
    store.windowCommand("window.minimize")
    await flushPromises()
    expect(command).toHaveBeenCalledOnce()
    const receipt = command.mock.calls[0]![0].mutation!.operationId
    store.stop()
    read.mockResolvedValue(rpcSuccess(snapshot("new-report")))
    store.start()
    await flushPromises()
    finish(rpcSuccess({ maximized: true }))
    await flushPromises()
    expect(store.snapshot?.reportId).toBe("new-report")
    expect(store.snapshot?.maximized).toBe(false)
    expect(command).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(250)
    expect(read.mock.calls.at(-1)![2]).toBe(receipt)
    expect(read.mock.calls.at(-1)![0].target).toEqual(snapshot().ref)
    await vi.advanceTimersByTimeAsync(250)
    expect(read.mock.calls.at(-1)![2]).toBeUndefined()
    store.windowCommand("window.toggle-maximize")
    await flushPromises()
    expect(command).toHaveBeenCalledTimes(2)
    expect(command.mock.calls[1]![1]).toEqual({ type: "set-maximized", maximized: true })
  })
})
