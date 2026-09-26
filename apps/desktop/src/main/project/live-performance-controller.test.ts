import { describe, expect, it, vi } from "vitest"
import type { LiveDocumentConfiguration, LiveRuntimeSnapshot, LiveSession } from "@heron/contracts"
import { applyLivePerformanceCommand } from "@heron/project-model"
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
  let revision = 0
  const session: LiveSession = {
    kind: "live",
    id: "stage",
    path: "Stage.hrl",
    configuration,
    dirty: false,
    recoveredWorkingCopy: false
  }
  const documents = {
    get current() {
      return session
    },
    baseline: vi.fn(async () => ({ snapshot: structuredClone(baseline), bindings: [], revision })),
    commitCapture: vi.fn(async (next: LiveRuntimeSnapshot, expected: number) => {
      if (expected !== revision) throw new Error("revision changed")
      baseline = structuredClone(next)
      session.dirty = true
      return ++revision
    })
  } as unknown as Pick<LiveDocumentService, "current" | "baseline" | "commitCapture">
  const port: LiveRuntimePort = {
    synchronizeEditState: vi.fn(async (snapshot) => snapshot),
    prepare: vi.fn(async (_configuration, snapshot) => {
      runtime = structuredClone(snapshot)
      return { id: "candidate" }
    }),
    activate: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    apply: vi.fn(async (command) => {
      runtime = applyLivePerformanceCommand(runtime, command)
    }),
    snapshot: vi.fn(async () => structuredClone(runtime)),
    restoreBaseline: vi.fn(async (_configuration, snapshot) => {
      runtime = structuredClone(snapshot)
    }),
    leave: vi.fn(async () => undefined)
  }
  return {
    documents,
    port,
    get baseline() {
      return baseline
    },
    get runtime() {
      return runtime
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
    expect(value.runtime.graph.channels[0]?.gainDb).toBe(-6)
    expect(controller.currentMode).toBe("edit")
  })

  it("keeps Edit on preparation failure and Perform on Capture failure", async () => {
    const value = fixture()
    const controller = new LivePerformanceController(value.documents, value.port)
    vi.mocked(value.port.prepare).mockRejectedValueOnce(new Error("missing plugin"))
    await expect(controller.enter()).rejects.toThrow("missing plugin")
    expect(controller.currentMode).toBe("edit")
    await controller.enter()
    await controller.adjust({ type: "channel", id: "audio", parameter: "gainDb", value: -4 })
    const preview = await controller.previewCapture()
    vi.mocked(value.documents.commitCapture).mockRejectedValueOnce(new Error("disk full"))
    await expect(controller.capture(preview.captureId, preview.fields)).rejects.toThrow("disk full")
    expect(controller.currentMode).toBe("perform")
    expect(controller.hasUncapturedChanges()).toBe(true)
    expect(value.runtime.graph.channels[0]?.gainDb).toBe(-4)
  })
})
