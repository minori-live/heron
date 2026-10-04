import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_DOCTOR_SETTINGS, pluginDescriptorKey } from "@heron/contracts"
import type {
  DoctorReport,
  PluginDescriptor,
  PluginInstanceState,
  PluginParameterInfo,
  PluginStateEnvelope
} from "@heron/contracts"
import { PluginDoctorService } from "./plugin-doctor-service"

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

function arrange() {
  let complete = false
  let cancelled = false
  const report: DoctorReport = {
    settings: { ...DEFAULT_DOCTOR_SETTINGS },
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
  const host = {
    loadPlugin: vi.fn(async (_plugin: PluginInstanceState, _rate: number) => ({
      latencySamples: 0,
      tailSamples: 0
    })),
    unloadDoctorPlugin: vi.fn(async () => {}),
    closePluginEditor: vi.fn(async () => {}),
    savePluginState: vi.fn(async (): Promise<PluginStateEnvelope> => ({ version: 1, chunks: [] })),
    pluginParameters: vi.fn(async (): Promise<PluginParameterInfo[]> => []),
    setPluginParameter: vi.fn(async () => {}),
    openPluginEditor: vi.fn(async () => ({ editorMode: "native" as const, open: true })),
    subscribeDoctorNotifications: vi.fn(() => () => {}),
    doctorRequest: vi.fn(async (command: Record<string, unknown>) => {
      if (command.type === "cancel-plugin-doctor") cancelled = true
      return {
        request_id: 1,
        result: {
          type: "plugin-doctor" as const,
          doctor_status: cancelled
            ? { state: "failed" as const, failure: "cancelled" as const }
            : complete
              ? { state: "completed" as const, report }
              : { state: "running" as const, phase: "linear", progress: 0.2 }
        }
      }
    })
  }
  const service = new PluginDoctorService(
    host,
    () => [descriptor],
    { locale: "en-US", theme: "dark" },
    () => 1000
  )
  return {
    service,
    host,
    complete: () => {
      complete = true
    },
    clearCancellation: () => {
      cancelled = false
    }
  }
}

describe("Plugin Doctor analysis session", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("debounces settings and preserves positive dBFS at the native boundary", async () => {
    const { service, host, complete } = arrange()
    await service.command(
      { type: "configure", settings: { ...DEFAULT_DOCTOR_SETTINGS, level_dbfs: 6 } },
      "a"
    )
    await vi.advanceTimersByTimeAsync(500)
    await service.command(
      { type: "configure", settings: { ...DEFAULT_DOCTOR_SETTINGS, level_dbfs: 12 } },
      "b"
    )
    await vi.advanceTimersByTimeAsync(599)
    expect(host.doctorRequest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(host.doctorRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start-plugin-doctor",
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
      settings: { ...DEFAULT_DOCTOR_SETTINGS, level_dbfs: 9 }
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
      { type: "configure", settings: { ...DEFAULT_DOCTOR_SETTINGS, level_dbfs: 6 } },
      "edit"
    )
    await vi.advanceTimersByTimeAsync(100)
    expect(service.snapshot().report).toBeNull()
    expect(host.doctorRequest).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cancel-plugin-doctor" })
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
    host.doctorRequest.mockRejectedValueOnce(new Error("lost response"))
    await service.command({ type: "analyze" }, "run")
    await vi.advanceTimersByTimeAsync(0)
    expect(service.snapshot().status).toBe("quarantined")
    expect(host.loadPlugin).toHaveBeenCalledTimes(2)
    expect(host.unloadDoctorPlugin).not.toHaveBeenCalled()
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
    expect(frozen.id).toMatch(/^doctor-measure-/)
    expect(frozen.state).toEqual(opaqueState)
    expect(host.setPluginParameter).toHaveBeenCalledWith({
      instanceId: frozen.id,
      parameterKey: parameter.parameterKey,
      value: 0.4,
      gesture: "end"
    })
    expect(host.unloadDoctorPlugin).not.toHaveBeenCalled()
    complete()
    await vi.advanceTimersByTimeAsync(100)
    expect(service.snapshot().status).toBe("complete")
    expect(host.unloadDoctorPlugin).toHaveBeenCalledWith(frozen.id)
    expect(host.unloadDoctorPlugin).not.toHaveBeenCalledWith(original.id)
    expect(service.snapshot().plugins[0]?.id).toBe(original.id)
    await service.close()
    expect(host.unloadDoctorPlugin).toHaveBeenCalledWith(original.id)
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
    host.doctorRequest.mockClear()
    host.pluginParameters.mockResolvedValue([{ ...parameter, value: 0.8 }])
    await vi.advanceTimersByTimeAsync(100)
    expect(service.snapshot().revision).toBe(2)
    await vi.advanceTimersByTimeAsync(599)
    expect(host.doctorRequest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(host.doctorRequest).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start-plugin-doctor" })
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
    expect(host.doctorRequest).toHaveBeenCalledWith(
      expect.objectContaining({ type: "release-plugin-doctor" })
    )
  })
})
