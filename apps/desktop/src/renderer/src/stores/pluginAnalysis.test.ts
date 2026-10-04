import { createPinia, setActivePinia } from "pinia"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_PLUGIN_ANALYSIS_SETTINGS } from "@heron/contracts"
import type { PluginAnalysisReport, PluginAnalysisSnapshot, ResourceRef } from "@heron/contracts"
import { rpcFailure, rpcSuccess } from "../test/ipc"
import { analysisSnapshot } from "../test/plugin-analysis"
import { usePluginAnalysisStore } from "./pluginAnalysis"

const ref: ResourceRef<"plugin-analysis"> = {
  kind: "plugin-analysis",
  id: "analysis",
  epoch: "epoch",
  generation: 1
}

function report(): PluginAnalysisReport {
  return {
    settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS },
    responses: [],
    harmonics: [],
    spectrograms: [],
    distortion: [],
    oscilloscopes: [],
    dynamics: [],
    models: [],
    performance: {
      reported_latency_samples: 0,
      average_block_us: 1,
      p95_block_us: 1,
      p99_block_us: 1,
      maximum_block_us: 1,
      budget_us: 1000,
      deadline_misses: 0,
      measured_blocks: 10,
      block_sizes: [],
      buffer_bytes: 100
    }
  }
}

function snapshot(
  reportValue: PluginAnalysisReport,
  reportId: string,
  reportRevision: number
): PluginAnalysisSnapshot {
  return {
    ref,
    revision: reportRevision,
    plugins: [],
    runtime: {},
    catalog: [],
    settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS },
    automatic: true,
    comparisonEnabled: false,
    repeating: false,
    comparisonReport: null,
    differenceReport: null,
    status: "complete",
    phase: "",
    progress: 1,
    report: reportValue,
    reportId,
    reportRevision,
    memory: null,
    failure: null,
    locale: "en-US",
    theme: "dark"
  }
}

const snapshotRequest = vi.fn()
const commandRequest = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  snapshotRequest.mockReset()
  commandRequest.mockReset()
  Object.defineProperty(window, "heronPluginAnalysis", {
    configurable: true,
    value: { platform: "win32", snapshot: snapshotRequest, command: commandRequest }
  })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(window, "heronPluginAnalysis")
})

describe("plugin analysis store report identity", () => {
  it("preserves report identity while polling the same run", async () => {
    const accepted = report()
    snapshotRequest
      .mockResolvedValueOnce(rpcSuccess(snapshot(accepted, "run-1", 3)))
      .mockResolvedValue(rpcSuccess(snapshot(report(), "run-1", 3)))
    const store = usePluginAnalysisStore()
    store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.snapshot?.report).toBe(accepted)
    await vi.advanceTimersByTimeAsync(250)
    expect(store.snapshot?.report).toBe(accepted)
    store.stop()
  })

  it("retains the report when a poll omits an unchanged body", async () => {
    const accepted = report()
    snapshotRequest
      .mockResolvedValueOnce(rpcSuccess(snapshot(accepted, "run-1", 3)))
      .mockResolvedValue(rpcSuccess({ ...snapshot(accepted, "run-1", 3), report: null }))
    const store = usePluginAnalysisStore()
    store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.snapshot?.report).toBe(accepted)
    await vi.advanceTimersByTimeAsync(250)
    expect(store.snapshot?.report).toBe(accepted)
    store.stop()
  })

  it("accepts a completed re-analysis at the same chain revision", async () => {
    const first = report()
    const second = report()
    snapshotRequest
      .mockResolvedValueOnce(rpcSuccess(snapshot(first, "run-1", 3)))
      .mockResolvedValue(rpcSuccess(snapshot(second, "run-2", 3)))
    const store = usePluginAnalysisStore()
    store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.snapshot?.report).toBe(first)
    await vi.advanceTimersByTimeAsync(250)
    expect(store.snapshot?.reportId).toBe("run-2")
    expect(store.snapshot?.report).toBe(second)
    store.stop()
  })
})

describe("plugin analysis commands", () => {
  it("rebases a settings patch after a revision conflict without reverting unrelated settings", async () => {
    const initial = analysisSnapshot()
    const authoritative = analysisSnapshot({
      revision: 4,
      settings: { ...initial.settings, block_size: 512 }
    })
    const committed = analysisSnapshot({
      revision: 5,
      settings: { ...authoritative.settings, level_dbfs: -6 }
    })
    snapshotRequest
      .mockResolvedValueOnce(rpcSuccess(initial))
      .mockResolvedValueOnce(rpcSuccess(authoritative))
      .mockResolvedValueOnce(rpcSuccess(committed))
    commandRequest
      .mockResolvedValueOnce(rpcFailure("conflict", { code: "revision-conflict" }))
      .mockResolvedValueOnce(rpcSuccess(committed))
    const store = usePluginAnalysisStore()
    store.start()
    await flushPromises()
    store.configure({ level_dbfs: -6 })
    await flushPromises()

    expect(commandRequest.mock.calls[1]?.[1]).toEqual({
      type: "configure",
      settings: committed.settings
    })
    const meta = commandRequest.mock.calls[1]![0]
    expect(meta.expectedRevision).toBe(4)
    expect(snapshotRequest.mock.calls[2]?.slice(1)).toEqual([meta.mutation.operationId, "run-1"])
    expect(store.snapshot?.settings).toEqual(committed.settings)
    expect(store.error).toBe("")
    store.stop()
  })

  it("does not replace an acknowledged command with a late pre-command poll", async () => {
    const initial = analysisSnapshot()
    const committed = analysisSnapshot({ revision: 4, automatic: false })
    let finishPoll!: (value: ReturnType<typeof rpcSuccess<PluginAnalysisSnapshot>>) => void
    snapshotRequest
      .mockResolvedValueOnce(rpcSuccess(initial))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishPoll = resolve
        })
      )
      .mockResolvedValue(rpcSuccess(committed))
    commandRequest.mockResolvedValue(rpcSuccess(committed))
    const store = usePluginAnalysisStore()
    store.start()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(250)
    store.command({ type: "automatic", enabled: false })
    await flushPromises()
    expect(store.snapshot?.automatic).toBe(false)

    finishPoll(rpcSuccess(initial))
    await flushPromises()
    expect(store.snapshot?.revision).toBe(4)
    expect(store.snapshot?.automatic).toBe(false)
    store.stop()
  })

  it("queues configuration patches against the latest committed settings", async () => {
    const initial = analysisSnapshot()
    const first = analysisSnapshot({
      revision: 4,
      settings: { ...initial.settings, level_dbfs: -6 }
    })
    const second = analysisSnapshot({
      revision: 5,
      settings: { ...first.settings, block_size: 512 }
    })
    snapshotRequest
      .mockResolvedValueOnce(rpcSuccess(initial))
      .mockResolvedValueOnce(rpcSuccess(first))
      .mockResolvedValueOnce(rpcSuccess(second))
    commandRequest
      .mockResolvedValueOnce(rpcSuccess(first))
      .mockResolvedValueOnce(rpcSuccess(second))
    const store = usePluginAnalysisStore()
    store.start()
    await flushPromises()
    store.configure({ level_dbfs: -6 })
    store.configure({ block_size: 512 })
    await flushPromises()
    expect(commandRequest.mock.calls[1]?.[1]).toEqual({
      type: "configure",
      settings: second.settings
    })
    expect(commandRequest.mock.calls[1]?.[0].expectedRevision).toBe(4)
    expect(store.snapshot?.settings).toEqual(second.settings)
    store.stop()
  })

  it("shows catalog failure, releases busy state, and recovers on the next command", async () => {
    const initial = analysisSnapshot()
    let finishCommand!: (value: ReturnType<typeof rpcFailure>) => void
    snapshotRequest.mockResolvedValue(rpcSuccess(initial))
    commandRequest
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishCommand = resolve
        })
      )
      .mockResolvedValueOnce(rpcSuccess(analysisSnapshot({ automatic: false })))
    const store = usePluginAnalysisStore()
    store.start()
    await flushPromises()
    store.command({ type: "refresh-catalog" })
    await flushPromises()
    expect(store.catalogBusy).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(snapshotRequest).toHaveBeenCalledTimes(1)
    finishCommand(rpcFailure("pluginAnalysis.failures.catalog-unavailable"))
    await flushPromises()
    expect(store.error).toContain("refresh the plug-in list")
    expect(store.catalogBusy).toBe(false)
    store.command({ type: "automatic", enabled: false })
    await flushPromises()
    expect(store.error).toBe("")
    store.stop()
  })

  it("ignores in-flight reads and queued commands after the analysis view closes", async () => {
    let finishPoll!: (value: ReturnType<typeof rpcSuccess<PluginAnalysisSnapshot>>) => void
    snapshotRequest.mockReturnValue(
      new Promise((resolve) => {
        finishPoll = resolve
      })
    )
    const store = usePluginAnalysisStore()
    store.start()
    store.command({ type: "analyze" })
    store.stop()
    finishPoll(rpcSuccess(analysisSnapshot()))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(500)
    expect(store.snapshot).toBeNull()
    expect(commandRequest).not.toHaveBeenCalled()
    expect(snapshotRequest).toHaveBeenCalledTimes(1)
  })

  it("does not retry a conflicted command after closing while its revision refresh is pending", async () => {
    let finishRefresh!: (value: ReturnType<typeof rpcSuccess<PluginAnalysisSnapshot>>) => void
    snapshotRequest.mockResolvedValueOnce(rpcSuccess(analysisSnapshot())).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRefresh = resolve
      })
    )
    commandRequest.mockResolvedValue(rpcFailure("conflict", { code: "revision-conflict" }))
    const store = usePluginAnalysisStore()
    store.start()
    await flushPromises()
    store.configure({ level_dbfs: -6 })
    await flushPromises()
    store.stop()
    finishRefresh(rpcSuccess(analysisSnapshot({ revision: 4 })))
    await flushPromises()
    expect(commandRequest).toHaveBeenCalledTimes(1)
    expect(store.snapshot?.revision).toBe(3)
    expect(store.catalogBusy).toBe(false)
  })
})
