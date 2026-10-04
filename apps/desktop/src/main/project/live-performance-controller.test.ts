import { describe, expect, it, vi } from "vitest"
import type { LiveDocumentConfiguration, LiveRuntimeSnapshot, LiveSession } from "@heron/contracts"
import { applyLiveCapture, applyLivePerformanceCommand } from "@heron/project-model"
import { LivePerformanceController, type LiveRuntimePort } from "./live-performance-controller"
import type { LiveDocumentService } from "./live-document-service"

function initialSnapshot(): LiveRuntimeSnapshot {
  return {
    graph: {
      sampleRate: 48_000,
      channels: [
        {
          id: "audio",
          kind: "audio",
          name: "Audio",
          color: "#4F8CFF",
          sortOrder: 0,
          inputSource: "hardware",
          inputFormat: "stereo",
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: "output",
          outputBus: null,
          inputMonitoring: false,
          inputChannels: [1, 2],
          hardwareOutputChannels: []
        },
        {
          id: "master",
          kind: "master",
          name: "Master",
          color: "#8C83FF",
          sortOrder: 0,
          inputSource: null,
          inputFormat: null,
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: null,
          outputBus: null,
          inputMonitoring: false,
          inputChannels: [],
          hardwareOutputChannels: []
        },
        {
          id: "output",
          kind: "output",
          name: "Output",
          color: "#EF7C95",
          sortOrder: 0,
          inputSource: null,
          inputFormat: null,
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: null,
          outputBus: null,
          inputMonitoring: false,
          inputChannels: [],
          hardwareOutputChannels: [1, 2]
        }
      ],
      sends: [],
      plugins: []
    },
    parameterValues: []
  }
}

function fixture() {
  const configuration: LiveDocumentConfiguration = {
    name: "Stage",
    sampleRate: 48_000,
    audio: { backend: "mock", inputDeviceId: "input", outputDeviceId: "output", bufferSize: 256 },
    enabledMidiDeviceIds: []
  }
  let baseline = initialSnapshot()
  let runtime = structuredClone(baseline)
  let running = false
  let revision = 0
  const session: LiveSession = {
    kind: "live",
    id: "stage",
    path: "Stage.hrl",
    configuration,
    dirty: false,
    recoveredWorkingCopy: false
  }
  const documents: Pick<
    LiveDocumentService,
    "current" | "baseline" | "commitCapture" | "commitLayerCapture"
  > = {
    get current() {
      return session
    },
    baseline: vi.fn(async () => ({
      snapshot: structuredClone(baseline),
      bindings: [],
      hierarchy: { sets: [], patches: [] },
      revision
    })),
    commitCapture: vi.fn(async (next: LiveRuntimeSnapshot, expected: number) => {
      if (expected !== revision) throw new Error("revision changed")
      baseline = structuredClone(next)
      session.dirty = true
      return ++revision
    }),
    commitLayerCapture: vi.fn(async (_layerId, frozen, available, selected, expected) => {
      if (expected !== revision) throw new Error("revision changed")
      baseline = applyLiveCapture(baseline, frozen, available, selected)
      session.dirty = true
      return {
        snapshot: structuredClone(baseline),
        bindings: [],
        hierarchy: { sets: [], patches: [] },
        revision: ++revision
      }
    })
  }
  const port: LiveRuntimePort = {
    synchronizeEditState: vi.fn(async (snapshot) => snapshot),
    prepare: vi.fn(async (_configuration, snapshot) => ({ snapshot: structuredClone(snapshot) })),
    activate: vi.fn(async (candidate, isCurrent) => {
      if (!isCurrent()) throw new Error("Superseded candidate")
      runtime = structuredClone((candidate as { snapshot: LiveRuntimeSnapshot }).snapshot)
      running = true
    }),
    abort: vi.fn(async () => undefined),
    apply: vi.fn(async (command) => {
      runtime = applyLivePerformanceCommand(runtime, command)
    }),
    snapshot: vi.fn(async () => structuredClone(runtime)),
    leave: vi.fn(async () => {
      running = false
    })
  }
  return {
    documents,
    port,
    get baseline() {
      return baseline
    },
    get runtime() {
      return runtime
    },
    get running() {
      return running
    }
  }
}

describe("Live Perform and Capture orchestration", () => {
  it("captures a frozen value while a newer adjustment stays temporary", async () => {
    const value = fixture()
    const controller = new LivePerformanceController(value.documents, value.port)
    await controller.enter()
    await controller.adjust({ type: "channel", id: "audio", parameter: "gainDb", value: -6 })
    const preview = await controller.previewCapture()
    await controller.adjust({ type: "channel", id: "audio", parameter: "gainDb", value: -12 })
    const remaining = await controller.capture(preview.captureId, preview.fields)
    expect(value.baseline.graph.channels[0]?.gainDb).toBe(-6)
    expect(value.runtime.graph.channels[0]?.gainDb).toBe(-12)
    expect(remaining).toEqual([{ type: "channel", id: "audio", parameter: "gainDb" }])
    expect(controller.hasUncapturedChanges()).toBe(true)
    expect(await controller.leave("cancel")).toBe(false)
    expect(controller.currentMode).toBe("perform")
    expect(await controller.leave("discard")).toBe(true)
    expect(value.running).toBe(false)
    expect(value.baseline.graph.channels[0]?.gainDb).toBe(-6)
    expect(controller.currentMode).toBe("edit")
  })

  it("keeps Edit on preparation failure and Perform on Capture failure", async () => {
    const value = fixture()
    const controller = new LivePerformanceController(value.documents, value.port)
    vi.mocked(value.port.prepare).mockRejectedValueOnce(new Error("missing plugin"))
    await expect(controller.enter()).rejects.toMatchObject({
      error: { code: "resource-unavailable", outcome: "not-committed" }
    })
    expect(controller.currentMode).toBe("edit")
    await controller.enter()
    await controller.adjust({ type: "channel", id: "audio", parameter: "gainDb", value: -4 })
    const preview = await controller.previewCapture()
    vi.mocked(value.documents.commitLayerCapture).mockRejectedValueOnce(new Error("disk full"))
    await expect(controller.capture(preview.captureId, preview.fields)).rejects.toMatchObject({
      error: { code: "resource-unavailable", outcome: "not-committed" }
    })
    expect(controller.currentMode).toBe("perform")
    expect(controller.hasUncapturedChanges()).toBe(true)
    expect(value.runtime.graph.channels[0]?.gainDb).toBe(-4)
  })
})
