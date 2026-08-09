import { describe, expect, it, vi } from "vitest"
import type {
  MidiControlEvent,
  MidiControlPreferences,
  ProjectGraphSnapshot
} from "@heron/contracts"
import { BUILTIN_MIDI_TRANSFORM_PROFILE_IDS } from "@heron/contracts"
import { MidiControlService, type MidiControlServiceOperations } from "./midi-control-service"

function graph(): ProjectGraphSnapshot {
  return {
    channels: [
      {
        id: "audio-1",
        kind: "audio",
        systemRole: null,
        sortOrder: 0,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false
      }
    ]
  } as ProjectGraphSnapshot
}

function event(value: number, generation = 1): MidiControlEvent {
  return {
    generation,
    timestampMicroseconds: generation * 10_000,
    portId: "controller",
    portName: "Controller",
    channel: 0,
    type: "control-change",
    number: 7,
    value
  }
}

function harness(preferences: MidiControlPreferences) {
  const dispatchApplicationCommand = vi.fn()
  const applyMixerControl = vi.fn(async () => {})
  const markDirty = vi.fn(async () => {})
  const operations: MidiControlServiceOperations = {
    graph,
    learning: () => false,
    dispatchApplicationCommand,
    applyMixerControl,
    pluginParameters: vi.fn(async () => []),
    applyPluginParameter: vi.fn(async () => {}),
    markDirty
  }
  const service = new MidiControlService(operations)
  service.configure(preferences)
  return { service, operations, dispatchApplicationCommand, applyMixerControl, markDirty }
}

const address = {
  portId: "controller",
  portName: "Controller",
  channel: 0,
  type: "control-change" as const,
  number: 7
}

describe("MidiControlService", () => {
  it("fans one address out across categories and isolates target failure", async () => {
    const setup = harness({
      bindings: [
        {
          id: "command",
          address,
          input: { type: "absolute" },
          target: { type: "application-command", command: "transport.toggle-playback" }
        },
        {
          id: "mute",
          address,
          input: { type: "absolute" },
          target: { type: "mixer", channelIndex: 0, parameter: "mute", behavior: "toggle" }
        }
      ],
      transformProfiles: []
    })
    setup.applyMixerControl.mockRejectedValueOnce(new Error("stale target"))
    setup.service.receive(event(127))
    await Promise.resolve()
    expect(setup.dispatchApplicationCommand).toHaveBeenCalledWith("transport.toggle-playback")
    expect(setup.applyMixerControl).toHaveBeenCalledWith("audio-1", "muted", true)
  })

  it("fires CC commands only on the below-64 to above-64 edge", () => {
    const setup = harness({
      bindings: [
        {
          id: "command",
          address,
          input: { type: "absolute" },
          target: { type: "application-command", command: "transport.toggle-playback" }
        }
      ],
      transformProfiles: []
    })
    for (const value of [127, 127, 0, 127]) setup.service.receive(event(value))
    expect(setup.dispatchApplicationCommand).toHaveBeenCalledTimes(2)
  })

  it("treats every non-zero absolute CC value as an enabled Mute/Solo state", async () => {
    const setup = harness({
      bindings: [
        {
          id: "mute",
          address,
          input: { type: "absolute" },
          target: { type: "mixer", channelIndex: 0, parameter: "mute", behavior: "absolute" }
        }
      ],
      transformProfiles: []
    })
    setup.service.receive(event(1))
    await Promise.resolve()
    expect(setup.applyMixerControl).toHaveBeenCalledWith("audio-1", "muted", true)
    setup.service.receive(event(0, 2))
    await Promise.resolve()
    expect(setup.applyMixerControl).toHaveBeenLastCalledWith("audio-1", "muted", false)
  })

  it("coalesces continuous events and applies the selected relative decoder", async () => {
    const setup = harness({
      bindings: [
        {
          id: "gain",
          address,
          input: { type: "relative", encoding: "one-127" },
          target: { type: "mixer", channelIndex: 0, parameter: "gain" },
          transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.relativeNormal
        }
      ],
      transformProfiles: []
    })
    setup.service.receive(event(1, 1))
    setup.service.receive(event(127, 2))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(setup.applyMixerControl).toHaveBeenCalledTimes(1)
    const calls = setup.applyMixerControl.mock.calls as unknown as [string, string, number][]
    expect(calls[0]![1]).toBe("gainDb")
    expect(calls[0]![2]).toBeLessThan(0)
  })
})
