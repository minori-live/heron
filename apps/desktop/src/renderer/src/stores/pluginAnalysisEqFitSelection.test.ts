import { computed } from "vue"
import { createPinia, disposePinia } from "pinia"
import { flushPromises } from "@vue/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { HeronPluginAnalysisApi, PluginAnalysisEqFitSelection } from "@heron/contracts"
import { analysisSnapshot } from "../test/plugin-analysis"
import { rpcFailure, rpcSuccess } from "../test/ipc"
import { usePluginAnalysisStore } from "./pluginAnalysis"
import { usePluginAnalysisEqFitSelectionStore } from "./pluginAnalysisEqFitSelection"

const piniaInstances: ReturnType<typeof createPinia>[] = []
afterEach(() => {
  piniaInstances.splice(0).forEach(disposePinia)
  Reflect.deleteProperty(window, "heronPluginAnalysis")
})
function setup() {
  const send = vi.fn<HeronPluginAnalysisApi["setEqFitSelection"]>(async (_meta, request) =>
    rpcSuccess({
      sequence: request.sequence,
      selectionRevision: 1,
      opened: request.open
    })
  )
  Object.defineProperty(window, "heronPluginAnalysis", {
    configurable: true,
    value: { platform: "win32", setEqFitSelection: send }
  })
  const pinia = createPinia()
  piniaInstances.push(pinia)
  const analysis = usePluginAnalysisStore(pinia)
  analysis.snapshot = analysisSnapshot({
    revision: 2,
    reportRevision: 2,
    reportId: "report-1",
    eqFitSequence: 10
  })
  const source = computed({
    get: () => analysis.snapshot!,
    set: (value) => {
      analysis.snapshot = value
    }
  })
  const controller = usePluginAnalysisEqFitSelectionStore(pinia)
  controller.start()
  const selection: PluginAnalysisEqFitSelection = {
    reportId: "report-1",
    reportRevision: 2,
    input: 0,
    output: 0,
    mode: "single"
  }
  return { source, send, controller, selection }
}

describe("EQ Fit source intent publication", () => {
  it("uses monotonic owner sequences without publishing polling clones or opening on selection alone", async () => {
    const { source, send, controller, selection } = setup()
    controller.select(selection)
    await flushPromises()
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]![1]).toEqual({ sequence: 12, selection, open: false })
    expect(send.mock.calls[0]![0]).toMatchObject({ target: source.value.ref, expectedRevision: 2 })
    source.value = structuredClone(source.value)
    controller.select({ ...selection })
    await flushPromises()
    expect(send).toHaveBeenCalledOnce()
    controller.open()
    await flushPromises()
    controller.open()
    await flushPromises()
    expect(send.mock.calls.slice(1).map(([, request]) => request)).toEqual([
      { sequence: 13, selection, open: true },
      { sequence: 14, selection, open: true }
    ])
  })

  it("delivers invalidation while an earlier open is pending and ignores its late failure", async () => {
    const { send, controller, selection } = setup()
    controller.select(selection)
    await flushPromises()
    let finish!: (result: Awaited<ReturnType<HeronPluginAnalysisApi["setEqFitSelection"]>>) => void
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    controller.open()
    await flushPromises()
    controller.select(null)
    await flushPromises()
    expect(send.mock.calls.at(-1)![1]).toEqual({ sequence: 14, selection: null, open: false })
    finish(rpcFailure("failed", { code: "resource-unavailable" }))
    await flushPromises()
    expect(controller.error).toBe("")
  })

  it("invalidates changed source revisions, recovers a new report, and prevents dispatch after disposal", async () => {
    const { source, send, controller, selection } = setup()
    controller.select(selection)
    await flushPromises()
    source.value = { ...source.value, revision: 3 }
    await flushPromises()
    expect(send.mock.calls.at(-1)![1].selection).toBeNull()
    source.value = { ...source.value, reportId: "report-2", reportRevision: 3 }
    controller.select({ ...selection, reportId: "report-2", reportRevision: 3 })
    await flushPromises()
    expect(send.mock.calls.at(-1)![1].selection?.reportId).toBe("report-2")
    const count = send.mock.calls.length
    controller.open()
    controller.stop()
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(count)
  })

  it("surfaces current transport failure and clears it when the user retries opening", async () => {
    const { send, controller, selection } = setup()
    controller.select(selection)
    send.mockRejectedValueOnce(new Error("disconnected"))
    await flushPromises()
    expect(controller.error).toBe("transport-unavailable")
    controller.open()
    await flushPromises()
    expect(controller.error).toBe("")
  })

  it("continues owner sequences across a local remount and rejects the previous scope's response", async () => {
    const { send, controller, selection } = setup()
    controller.select(selection)
    await flushPromises()
    let finish!: (result: Awaited<ReturnType<HeronPluginAnalysisApi["setEqFitSelection"]>>) => void
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    controller.open()
    await flushPromises()
    const previousSequence = send.mock.calls.at(-1)![1].sequence
    controller.stop()
    controller.start()
    controller.select(selection)
    await flushPromises()
    expect(send.mock.calls.at(-1)![1]).toMatchObject({ selection, open: false })
    expect(send.mock.calls.at(-1)![1].sequence).toBeGreaterThan(previousSequence)
    finish(rpcFailure("old-window-load", { code: "resource-unavailable" }))
    await flushPromises()
    expect(controller.error).toBe("")
    controller.open()
    await flushPromises()
    expect(send.mock.calls.at(-1)![1].open).toBe(true)
  })
})
