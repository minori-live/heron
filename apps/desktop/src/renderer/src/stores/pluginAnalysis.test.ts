import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_PLUGIN_ANALYSIS_SETTINGS } from "@heron/contracts"
import type { PluginAnalysisReport, PluginAnalysisSnapshot, ResourceRef } from "@heron/contracts"
import { rpcSuccess } from "../test/ipc"
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
