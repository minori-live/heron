import { describe, expect, it, vi } from "vitest"
import type { ProjectGraphSnapshot } from "@heron/contracts"
import type { AudioGraphPublisher } from "./audio-graph-publisher"
import { ProjectGraphService } from "./project-graph-service"
import type { ProjectService } from "./project-service"

function graph(): ProjectGraphSnapshot {
  return {
    sampleRate: 48_000,
    tracks: [],
    channels: [
      {
        id: "output",
        kind: "output",
        systemRole: null,
        name: "Output 1–2",
        color: "#000000",
        sortOrder: 0,
        inputSource: null,
        inputFormat: null,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: null,
        outputBus: null,
        recordArmed: false,
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: [1, 2]
      }
    ],
    audioClips: [],
    sends: [],
    plugins: [],
    midiClips: [],
    tempoMap: {
      ticksPerQuarter: 960,
      tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
      timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
    },
    keySignatureEvents: [{ tick: 0, fifths: 0, mode: "major" }]
  }
}

describe("ProjectGraphService Low Latency Mode", () => {
  it("restores normal policy when persisting a newly enabled budget fails", async () => {
    const source = graph()
    const publish = vi.fn(async () => structuredClone(source))
    const publisher = {
      resolve: vi.fn((value: ProjectGraphSnapshot) => structuredClone(value)),
      publish,
      lowLatencyPluginBudgetMs: vi.fn(async () => 5),
      setLowLatencyPluginBudgetMs: vi.fn(async () => {
        throw new Error("settings-write-failed")
      }),
      compiledAudioGraphSnapshot: vi.fn(async () => null)
    } as unknown as AudioGraphPublisher
    const projects = { current: { id: "project" } } as unknown as ProjectService
    const service = new ProjectGraphService(projects, publisher)
    service.commit("project", source)

    await expect(
      service.configureLowLatencyMode({ enabled: true, pluginBudgetMs: 10 })
    ).rejects.toThrow("settings-write-failed")

    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenNthCalledWith(1, expect.anything(), {
      latencyPolicy: {
        type: "low-latency",
        targetOutputChannelId: "output",
        pluginBudgetSamples: 480
      },
      awaitPublication: true
    })
    expect(publish).toHaveBeenNthCalledWith(2, expect.anything(), {
      latencyPolicy: { type: "normal" },
      awaitPublication: true
    })
    await expect(service.lowLatencySnapshot()).resolves.toMatchObject({
      enabled: false,
      targetOutputChannelId: "output",
      pluginBudgetMs: 5
    })
  })
})

describe("ProjectGraphService MIDI control overlay", () => {
  function setup() {
    const source = graph()
    const publish = vi.fn(async (value: ProjectGraphSnapshot) => structuredClone(value))
    const publisher = {
      resolve: vi.fn((value: ProjectGraphSnapshot) => structuredClone(value)),
      publish,
      compiledAudioGraphSnapshot: vi.fn(async () => null)
    } as unknown as AudioGraphPublisher
    const saveControlState = vi.fn(async () => undefined)
    const projects = {
      current: { id: "project" },
      saveControlState
    } as unknown as ProjectService
    const service = new ProjectGraphService(projects, publisher)
    service.commit("project", source)
    return { service, publish, saveControlState }
  }

  it("applies, reconciles, and saves mixer values without mutating the persisted graph", async () => {
    const { service, publish, saveControlState } = setup()

    await expect(service.applyMidiControl("missing", "gainDb", 4)).resolves.toBe(false)
    await service.applyMidiControl("output", "gainDb", -12)
    await service.applyMidiControl("output", "pan", 0.5)
    expect(service.midiControlOverlaySnapshot()).toEqual([
      { channelId: "output", gainDb: -12, pan: 0.5 }
    ])
    expect((await service.snapshot()).channels[0]).toMatchObject({ gainDb: -12, pan: 0.5 })
    expect(publish).not.toHaveBeenCalled()

    await service.applyMidiControl("output", "muted", true)
    expect(publish).toHaveBeenCalledOnce()
    expect(publish.mock.calls[0]?.[0].channels[0]).toMatchObject({
      gainDb: -12,
      pan: 0.5,
      muted: true
    })

    service.reconcileProjectCommand({
      type: "update-channel",
      channelId: "output",
      patch: { pan: -0.25 }
    })
    expect((await service.snapshot()).channels[0]).toMatchObject({ gainDb: -12, pan: 0 })

    await service.savePluginStates([])
    expect(saveControlState).toHaveBeenCalledWith([], [{ id: "output", gainDb: -12, muted: true }])
    expect((await service.snapshot()).channels[0]).toMatchObject({ gainDb: -12, muted: true })
  })

  it("clears overlays for nested delete commands and ignores unrelated commands", async () => {
    const { service } = setup()
    await service.applyMidiControl("output", "soloed", true)

    service.reconcileProjectCommand({ type: "update-project-notes", notes: "unchanged" })
    service.reconcileProjectCommand({
      type: "update-channel",
      channelId: "missing",
      patch: { gainDb: 1 }
    })
    expect((await service.snapshot()).channels[0]?.soloed).toBe(true)

    service.reconcileProjectCommand({
      type: "batch",
      commands: [{ type: "delete-channel", channelId: "output" }]
    })
    expect((await service.snapshot()).channels[0]?.soloed).toBe(false)
  })

  it("rolls back a discrete overlay when graph publication fails", async () => {
    const { service, publish } = setup()
    publish.mockRejectedValueOnce(new Error("audio graph unavailable"))

    await expect(service.applyMidiControl("output", "muted", true)).rejects.toThrow(
      "audio graph unavailable"
    )

    expect(service.midiControlOverlaySnapshot()).toEqual([])
    expect((await service.snapshot()).channels[0]?.muted).toBe(false)
  })
})
