import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_PLUGIN_ANALYSIS_SETTINGS, pluginDescriptorKey } from "@heron/contracts"
import type {
  PluginAnalysisReport,
  PluginDescriptor,
  PluginInstanceState,
  PluginParameterInfo,
  PluginStateEnvelope
} from "@heron/contracts"
import { PluginAnalysisService } from "./plugin-analysis-service"

const descriptor: PluginDescriptor = {
  source: { kind: "external" },
  locator: {
    format: "vst3",
    artifactPath: "/plugins/Gain.vst3",
    nativeId: "ABCDEF0123456789ABCDEF0123456789"
  },
  name: "Gain",
  vendor: "Heron",
  version: "1",
  categories: ["Fx"],
  kind: "effect",
  architecture: "x86_64",
  buses: [],
  supportedAudioModes: ["stereo"],
  hasEditor: true,
  compatibility: "compatible",
  compatibilityReason: null
}
const parameter: PluginParameterInfo = {
  parameterKey: "vst3:1",
  runtimeToken: 1,
  title: "Gain",
  shortTitle: "Gain",
  units: "",
  stepCount: 0,
  minValue: 0,
  maxValue: 1,
  defaultValue: 1,
  value: 0.4,
  normalizedValue: 0.4,
  normalized: 0.4,
  defaultNormalized: 1
}

function arrange(
  options: {
    refreshCatalog?: () => Promise<unknown>
    resolveDescriptor?: (descriptor: PluginDescriptor) => Promise<PluginDescriptor>
  } = {}
) {
  let complete = false
  let cancelled = false
  const report: PluginAnalysisReport = {
    settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS },
    responses: [],
    harmonics: [],
    spectrograms: [],
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
  const notificationListeners: Array<
    (event: { instanceId: string; kind: string; value: string }) => void
  > = []
  const host = {
    loadPlugin: vi.fn(async (_plugin: PluginInstanceState, _rate: number) => ({
      latencySamples: 0,
      tailSamples: 0
    })),
    unloadPluginAnalysisPlugin: vi.fn(async () => {}),
    closePluginEditor: vi.fn(async () => {}),
    savePluginState: vi.fn(async (): Promise<PluginStateEnvelope> => ({ version: 1, chunks: [] })),
    pluginParameters: vi.fn(async (): Promise<PluginParameterInfo[]> => []),
    setPluginParameter: vi.fn(async () => {}),
    openPluginEditor: vi.fn(async () => ({ editorMode: "native" as const, open: true })),
    subscribePluginAnalysisNotifications: vi.fn(
      (listener: (event: { instanceId: string; kind: string; value: string }) => void) => {
        notificationListeners.push(listener)
        return () => {}
      }
    ),
    pluginAnalysisRequest: vi.fn(async (command: Record<string, unknown>) => {
      if (command.type === "cancel-plugin-analysis") cancelled = true
      return {
        request_id: 1,
        result: {
          type: "plugin-analysis" as const,
          plugin_analysis_status: cancelled
            ? { state: "failed" as const, failure: "cancelled" as const }
            : complete
              ? { state: "completed" as const, report }
              : { state: "running" as const, phase: "linear", progress: 0.2 }
        }
      }
    })
  }
  const service = new PluginAnalysisService(
    host,
    () => [descriptor],
    { locale: "en-US", theme: "dark" },
    () => 1000,
    options.resolveDescriptor ?? (async (value) => value),
    options.refreshCatalog
  )
  return {
    service,
    host,
    complete: () => {
      complete = true
    },
    clearCancellation: () => {
      cancelled = false
    },
    notify: (event: { instanceId: string; kind: string; value: string }) => {
      for (const listener of notificationListeners) listener(event)
    }
  }
}

async function insertEffect(service: PluginAnalysisService, operationId = "insert", slotOrder = 0) {
  return service.command(
    { type: "insert", pluginKey: pluginDescriptorKey(descriptor), audioMode: "stereo", slotOrder },
    operationId
  )
}

describe("Plugin Analysis analysis session", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("debounces settings and preserves positive dBFS at the native boundary", async () => {
    const { service, host, complete } = arrange()
    await service.command(
      { type: "configure", settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, level_dbfs: 6 } },
      "a"
    )
    await vi.advanceTimersByTimeAsync(500)
    await service.command(
      { type: "configure", settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, level_dbfs: 12 } },
      "b"
    )
    await vi.advanceTimersByTimeAsync(599)
    expect(host.pluginAnalysisRequest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(host.pluginAnalysisRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start-plugin-analysis",
        settings: expect.objectContaining({ level_dbfs: 12 })
      })
    )
    complete()
    await vi.advanceTimersByTimeAsync(100)
    expect(service.snapshot().status).toBe("complete")
    expect(service.snapshot().reportRevision).toBe(2)
    await service.close()
  })

  it("retains idempotent mutation receipts until renderer acknowledgement", async () => {
    const { service } = arrange()
    const command = {
      type: "configure" as const,
      settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, level_dbfs: 9 }
    }
    const first = await service.command(command, "same")
    await service.command(command, "same")
    expect(service.snapshot().revision).toBe(first.revision)
    expect(service.hasReceipt("same", command)).toBe(true)
    service.acknowledge("same")
    expect(service.hasReceipt("same", command)).toBe(false)
    await service.close()
  })

  it("cancels a stale analysis before starting the newest revision", async () => {
    const { service, host, complete, clearCancellation } = arrange()
    await service.command({ type: "analyze" }, "run")
    await vi.advanceTimersByTimeAsync(0)
    await service.command(
      { type: "configure", settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, level_dbfs: 6 } },
      "edit"
    )
    await vi.advanceTimersByTimeAsync(100)
    expect(service.snapshot().report).toBeNull()
    expect(host.pluginAnalysisRequest).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cancel-plugin-analysis" })
    )
    clearCancellation()
    complete()
    await vi.advanceTimersByTimeAsync(600)
    expect(service.snapshot().reportRevision).toBe(1)
    await service.close()
  })

  it("quarantines an unknown native start outcome without releasing its endpoints", async () => {
    const { service, host } = arrange()
    await service.command(
      {
        type: "insert",
        pluginKey: pluginDescriptorKey(descriptor),
        audioMode: "stereo",
        slotOrder: 0
      },
      "insert"
    )
    host.pluginAnalysisRequest.mockRejectedValueOnce(new Error("lost response"))
    await service.command({ type: "analyze" }, "run")
    await vi.advanceTimersByTimeAsync(0)
    expect(service.snapshot().status).toBe("quarantined")
    expect(host.loadPlugin).toHaveBeenCalledTimes(2)
    expect(host.unloadPluginAnalysisPlugin).not.toHaveBeenCalled()
    await service.close()
  })

  it("freezes state and parameters in independent instances and releases them before report publication", async () => {
    const { service, host, complete } = arrange()
    await service.command({ type: "automatic", enabled: false }, "manual")
    const opaqueState: PluginStateEnvelope = {
      version: 1,
      chunks: [{ key: "component", bytes: new Uint8Array([1, 2, 3]) }]
    }
    host.pluginParameters.mockResolvedValue([parameter])
    host.savePluginState.mockResolvedValue(opaqueState)
    await service.command(
      {
        type: "insert",
        pluginKey: pluginDescriptorKey(descriptor),
        audioMode: "stereo",
        slotOrder: 0
      },
      "insert"
    )
    const original = service.snapshot().plugins[0]!
    await service.command({ type: "analyze" }, "run")
    await vi.advanceTimersByTimeAsync(0)
    const frozen = host.loadPlugin.mock.calls[1]![0]
    expect(frozen.id).not.toBe(original.id)
    expect(frozen.id).toMatch(/^plugin-analysis-measure-/)
    expect(frozen.state).toEqual(opaqueState)
    expect(host.setPluginParameter).toHaveBeenCalledWith({
      instanceId: frozen.id,
      parameterKey: parameter.parameterKey,
      value: 0.4,
      gesture: "end"
    })
    expect(host.unloadPluginAnalysisPlugin).not.toHaveBeenCalled()
    let confirmRelease!: () => void
    host.unloadPluginAnalysisPlugin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          confirmRelease = resolve
        })
    )
    complete()
    await vi.advanceTimersByTimeAsync(100)
    expect(service.snapshot().status).toBe("running")
    expect(service.snapshot().report).toBeNull()
    confirmRelease()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.snapshot().status).toBe("complete")
    expect(host.unloadPluginAnalysisPlugin).toHaveBeenCalledWith(frozen.id)
    expect(host.unloadPluginAnalysisPlugin).not.toHaveBeenCalledWith(original.id)
    expect(service.snapshot().plugins[0]?.id).toBe(original.id)
    await service.close()
    expect(host.unloadPluginAnalysisPlugin).toHaveBeenCalledWith(original.id)
  })

  it("reanalyzes polled editor parameter changes through the trailing debounce", async () => {
    const { service, host, complete } = arrange()
    complete()
    host.pluginParameters.mockResolvedValue([parameter])
    await service.command(
      {
        type: "insert",
        pluginKey: pluginDescriptorKey(descriptor),
        audioMode: "stereo",
        slotOrder: 0
      },
      "insert"
    )
    await vi.advanceTimersByTimeAsync(200)
    host.pluginAnalysisRequest.mockClear()
    host.pluginParameters.mockResolvedValue([{ ...parameter, value: 0.8 }])
    await vi.advanceTimersByTimeAsync(100)
    expect(service.snapshot().revision).toBe(2)
    await vi.advanceTimersByTimeAsync(599)
    expect(host.pluginAnalysisRequest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(host.pluginAnalysisRequest).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start-plugin-analysis" })
    )
    const closing = service.close()
    await vi.advanceTimersByTimeAsync(100)
    await closing
  })

  it("waits for native cancellation before closing the session", async () => {
    const { service, host } = arrange()
    await service.command({ type: "analyze" }, "run")
    await vi.advanceTimersByTimeAsync(0)
    const closing = service.close()
    await vi.advanceTimersByTimeAsync(100)
    await closing
    expect(host.pluginAnalysisRequest).toHaveBeenCalledWith(
      expect.objectContaining({ type: "release-plugin-analysis" })
    )
  })

  it("publishes a distinct report identity for a repeated analysis at the same revision", async () => {
    const { service, complete } = arrange()
    await service.command({ type: "analyze" }, "first")
    await vi.advanceTimersByTimeAsync(0)
    complete()
    await vi.advanceTimersByTimeAsync(100)
    const first = service.snapshot()
    expect(first.status).toBe("complete")
    expect(first.reportId).not.toBeNull()
    await service.command({ type: "analyze" }, "second")
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    const second = service.snapshot()
    expect(second.status).toBe("complete")
    expect(second.reportRevision).toBe(first.reportRevision)
    expect(second.reportId).not.toBe(first.reportId)
    await service.close()
  })

  it("omits the report body while the caller's run identity is current", async () => {
    const { service, complete } = arrange()
    await service.command({ type: "analyze" }, "run")
    await vi.advanceTimersByTimeAsync(0)
    complete()
    await vi.advanceTimersByTimeAsync(100)
    const full = service.snapshot()
    expect(full.report).not.toBeNull()
    const omitted = service.snapshot(full.reportId!)
    expect(omitted.report).toBeNull()
    expect(omitted.reportId).toBe(full.reportId)
    expect(service.snapshot("another-run").report).not.toBeNull()
    await service.close()
  })

  it("advances the revision for the native CLAP reconfigure notification", async () => {
    const { service, notify } = arrange()
    await service.command({ type: "automatic", enabled: false }, "manual")
    await service.command(
      {
        type: "insert",
        pluginKey: pluginDescriptorKey(descriptor),
        audioMode: "stereo",
        slotOrder: 0
      },
      "insert"
    )
    const instanceId = service.snapshot().plugins[0]!.id
    const revision = service.snapshot().revision
    notify({ instanceId, kind: "clap-reconfigure-requested", value: "restart=false" })
    expect(service.snapshot().revision).toBe(revision + 1)
    await service.close()
  })

  it("retains a visible failure across unrelated commands and clears it when resolved", async () => {
    const refreshCatalog = vi.fn<() => Promise<unknown>>(async () => {
      throw new Error("scan failed")
    })
    const { service } = arrange({ refreshCatalog })
    await service.command({ type: "refresh-catalog" }, "catalog-fail")
    expect(service.snapshot().failure).toBe("catalog-unavailable")
    await service.command({ type: "window", action: "minimize" }, "chrome")
    await service.command({ type: "editor", instanceId: "missing" }, "editor")
    await service.command(
      { type: "insert", pluginKey: "missing", audioMode: "stereo", slotOrder: 0 },
      "rejected-insert"
    )
    expect(service.snapshot().failure).toBe("catalog-unavailable")
    refreshCatalog.mockImplementation(async () => undefined)
    await service.command({ type: "refresh-catalog" }, "catalog-ok")
    expect(service.snapshot().failure).toBeNull()
    await service.close()
  })

  it("clears prepare-failed after a successful editor open or remove", async () => {
    const { service, host } = arrange()
    await service.command(
      {
        type: "insert",
        pluginKey: pluginDescriptorKey(descriptor),
        audioMode: "stereo",
        slotOrder: 0
      },
      "insert"
    )
    const instanceId = service.snapshot().plugins[0]!.id
    host.openPluginEditor.mockRejectedValueOnce(new Error("editor failed"))
    await service.command({ type: "editor", instanceId }, "editor-fail")
    expect(service.snapshot().failure).toBe("prepare-failed")
    await service.command({ type: "editor", instanceId }, "editor-ok")
    expect(service.snapshot().failure).toBeNull()
    host.openPluginEditor.mockRejectedValueOnce(new Error("editor failed"))
    await service.command({ type: "editor", instanceId }, "editor-fail-again")
    expect(service.snapshot().failure).toBe("prepare-failed")
    await service.command({ type: "remove", instanceId }, "remove")
    expect(service.snapshot().failure).toBeNull()
    await service.close()
  })

  it("rejects a newly incompatible catalog probe without allocating an instance, then recovers", async () => {
    const resolveDescriptor = vi.fn(async (): Promise<PluginDescriptor> => ({
      ...descriptor,
      compatibility: "unsupported-buses"
    }))
    const { service, host } = arrange({ resolveDescriptor })
    await service.command({ type: "automatic", enabled: false }, "manual")
    await insertEffect(service, "incompatible")
    expect(service.snapshot()).toMatchObject({
      plugins: [],
      failure: "prepare-failed",
      status: "failed",
      revision: 0
    })
    expect(host.loadPlugin).not.toHaveBeenCalled()

    resolveDescriptor.mockResolvedValueOnce(descriptor)
    await insertEffect(service, "compatible")
    expect(service.snapshot().plugins).toHaveLength(1)
    expect(service.snapshot().failure).toBeNull()
    expect(service.snapshot().revision).toBe(1)
    await service.close()
  })

  it("releases a partially loaded insert before returning a recoverable prepare failure", async () => {
    const { service, host } = arrange()
    await service.command({ type: "automatic", enabled: false }, "manual")
    host.pluginParameters.mockRejectedValueOnce(new Error("parameters unavailable"))
    await insertEffect(service)

    const candidate = host.loadPlugin.mock.calls[0]![0]
    expect(host.unloadPluginAnalysisPlugin).toHaveBeenCalledWith(candidate.id)
    expect(service.snapshot()).toMatchObject({
      plugins: [],
      runtime: {},
      revision: 0,
      failure: "prepare-failed",
      status: "failed"
    })
    await insertEffect(service, "retry")
    expect(service.snapshot().plugins).toHaveLength(1)
    expect(service.snapshot().failure).toBeNull()
    await service.close()
  })

  it("retains the chain and quarantines commands when removal cannot confirm instance cleanup", async () => {
    const { service, host } = arrange()
    await service.command({ type: "automatic", enabled: false }, "manual")
    await insertEffect(service)
    const before = service.snapshot()
    const instanceId = before.plugins[0]!.id
    host.unloadPluginAnalysisPlugin.mockRejectedValueOnce(new Error("release outcome unknown"))
    await service.command({ type: "remove", instanceId }, "remove")

    expect(service.snapshot()).toMatchObject({
      status: "quarantined",
      failure: "cleanup-failed",
      plugins: before.plugins,
      revision: before.revision
    })
    await service.command({ type: "toggle", instanceId, enabled: false }, "quarantined-edit")
    await service.command({ type: "analyze" }, "quarantined-analyze")
    await vi.advanceTimersByTimeAsync(1000)
    expect(service.snapshot().plugins).toEqual(before.plugins)
    expect(host.pluginAnalysisRequest).not.toHaveBeenCalled()
    await service.close()
    expect(host.unloadPluginAnalysisPlugin).toHaveBeenCalledTimes(1)
  })

  it("cancels preparation without starting a native job and releases the prepared candidate", async () => {
    const { service, host } = arrange()
    await service.command({ type: "automatic", enabled: false }, "manual")
    await insertEffect(service)
    const originalId = service.snapshot().plugins[0]!.id
    let finishLoad!: (timing: { latencySamples: number; tailSamples: number }) => void
    host.loadPlugin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve
        })
    )
    await service.command({ type: "analyze" }, "analyze")
    await vi.advanceTimersByTimeAsync(0)
    const candidateId = host.loadPlugin.mock.calls[1]![0].id
    await service.command({ type: "cancel" }, "cancel")
    finishLoad({ latencySamples: 0, tailSamples: 0 })
    await vi.advanceTimersByTimeAsync(0)

    expect(service.snapshot()).toMatchObject({ status: "cancelled", report: null })
    expect(host.pluginAnalysisRequest).not.toHaveBeenCalled()
    expect(host.unloadPluginAnalysisPlugin).toHaveBeenCalledWith(candidateId)
    expect(host.unloadPluginAnalysisPlugin).not.toHaveBeenCalledWith(originalId)
    await service.close()
  })

  it("measures only enabled effects in committed rack order after move and bypass", async () => {
    const { service, host, complete } = arrange()
    await service.command({ type: "automatic", enabled: false }, "manual")
    await insertEffect(service, "first")
    await insertEffect(service, "second", 1)
    const [first, second] = service.snapshot().plugins
    await service.command({ type: "move", instanceId: second!.id, slotOrder: 0 }, "move")
    await service.command({ type: "toggle", instanceId: first!.id, enabled: false }, "bypass")
    expect(
      service.snapshot().plugins.map(({ id, slotOrder, enabled }) => ({ id, slotOrder, enabled }))
    ).toEqual([
      { id: second!.id, slotOrder: 0, enabled: true },
      { id: first!.id, slotOrder: 1, enabled: false }
    ])
    complete()
    await service.command({ type: "analyze" }, "analyze")
    await vi.advanceTimersByTimeAsync(0)

    expect(host.savePluginState.mock.calls).toEqual([[second!.id]])
    expect(host.loadPlugin).toHaveBeenCalledTimes(3)
    const measured = host.loadPlugin.mock.calls[2]![0]
    expect(measured.slotOrder).toBe(0)
    expect(host.pluginAnalysisRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start-plugin-analysis",
        instance_ids: [measured.id]
      })
    )
    expect(service.snapshot()).toMatchObject({ status: "complete", reportRevision: 4 })
    await service.close()
  })
})
