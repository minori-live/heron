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

function harness(
  preferences: MidiControlPreferences,
  overrides: Partial<MidiControlServiceOperations> = {}
) {
  const dispatchApplicationCommand = vi.fn()
  const applyMixerControl = vi.fn(async (): Promise<boolean | void> => undefined)
  const markDirty = vi.fn(async () => {})
  const operations: MidiControlServiceOperations = {
    graph,
    learning: () => false,
    dispatchApplicationCommand,
    applyMixerControl,
    pluginParameters: vi.fn(async () => []),
    applyPluginParameter: vi.fn(async () => {}),
    markDirty,
    ...overrides
  }
  const service = new MidiControlService(operations)
  service.configure(preferences)
  return { service, operations, dispatchApplicationCommand, applyMixerControl, markDirty }
}

function flushContinuous(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
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

  it("maps absolute gain and pan values and reuses the effective continuous state", async () => {
    const setup = harness({
      bindings: [
        {
          id: "gain",
          address,
          input: { type: "absolute" },
          target: { type: "mixer", channelIndex: 0, parameter: "gain" },
          transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
        },
        {
          id: "pan",
          address,
          input: { type: "absolute" },
          target: { type: "mixer", channelIndex: 0, parameter: "pan" },
          transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
        }
      ],
      transformProfiles: []
    })

    setup.service.receive(event(127))
    await flushContinuous()
    expect(setup.applyMixerControl).toHaveBeenCalledWith("audio-1", "gainDb", 12)
    expect(setup.applyMixerControl).toHaveBeenCalledWith("audio-1", "pan", 1)
    expect(setup.markDirty).toHaveBeenCalledTimes(2)

    setup.service.receive(event(0, 2))
    await flushContinuous()
    expect(setup.applyMixerControl).toHaveBeenCalledWith("audio-1", "gainDb", -90)
    expect(setup.applyMixerControl).toHaveBeenCalledWith("audio-1", "pan", -1)
  })

  it("resolves plug-ins strictly by alias and filters inaccessible parameters", async () => {
    const pluginParameters = vi.fn(
      async () =>
        [
          {
            parameterKey: "hidden",
            title: "Hidden",
            value: 0,
            minValue: 0,
            maxValue: 1,
            hidden: true,
            readOnly: false,
            automatable: true
          },
          {
            parameterKey: "cutoff",
            title: "Cutoff",
            value: 20,
            minValue: 20,
            maxValue: 20_020,
            hidden: false,
            readOnly: false,
            automatable: true
          }
        ] as never
    )
    const applyPluginParameter = vi.fn(async () => {})
    const pluginGraph = {
      ...graph(),
      plugins: [{ id: "plugin-1", controlAlias: "lead" } as never]
    }
    const setup = harness(
      {
        bindings: [
          {
            id: "plugin",
            address,
            input: { type: "absolute" },
            target: { type: "plugin-parameter", controlAlias: "lead", parameterKey: "cutoff" },
            transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
          }
        ],
        transformProfiles: []
      },
      { graph: () => pluginGraph, pluginParameters, applyPluginParameter }
    )

    setup.service.receive(event(64))
    await flushContinuous()
    expect(pluginParameters).toHaveBeenCalledWith("plugin-1")
    expect(applyPluginParameter).toHaveBeenCalledWith(
      "plugin-1",
      expect.objectContaining({ parameterKey: "cutoff" }),
      expect.closeTo(20 + (64 / 127) * 20_000)
    )
  })

  it("ignores learning, unknown addresses, missing targets, mismatched profiles, and zero deltas", async () => {
    const missingAddress = { ...address, number: 99 }
    const setup = harness(
      {
        bindings: [
          {
            id: "missing-mixer",
            address,
            input: { type: "absolute" },
            target: { type: "mixer", channelIndex: 99, parameter: "gain" },
            transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
          },
          {
            id: "zero-relative",
            address,
            input: { type: "relative", encoding: "twos-complement" },
            target: { type: "mixer", channelIndex: 0, parameter: "pan" },
            transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.relativeNormal
          },
          {
            id: "mismatch",
            address,
            input: { type: "relative", encoding: "one-127" },
            target: { type: "mixer", channelIndex: 0, parameter: "gain" },
            transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
          }
        ],
        transformProfiles: []
      },
      { learning: () => true }
    )

    setup.service.receive(event(0))
    setup.service.receive({ ...event(127), number: missingAddress.number })
    await flushContinuous()
    expect(setup.applyMixerControl).not.toHaveBeenCalled()

    setup.operations.learning = () => false
    setup.service.receive(event(0, 2))
    await flushContinuous()
    expect(setup.applyMixerControl).not.toHaveBeenCalled()
  })

  it("toggles Note On solo from graph state and then from the effective overlay", async () => {
    const noteAddress = { ...address, type: "note" as const, number: 60 }
    const setup = harness({
      bindings: [
        {
          id: "solo",
          address: noteAddress,
          input: { type: "note" },
          target: { type: "mixer", channelIndex: 0, parameter: "solo", behavior: "toggle" }
        }
      ],
      transformProfiles: []
    })

    setup.service.receive({ ...event(127), type: "note", number: 60 })
    await Promise.resolve()
    setup.service.receive({ ...event(127, 2), type: "note", number: 60 })
    await Promise.resolve()

    expect(setup.applyMixerControl.mock.calls).toEqual([
      ["audio-1", "soloed", true],
      ["audio-1", "soloed", false]
    ])
  })

  it("cancels pending continuous work when bindings are reconfigured", async () => {
    const setup = harness({
      bindings: [
        {
          id: "gain",
          address,
          input: { type: "absolute" },
          target: { type: "mixer", channelIndex: 0, parameter: "gain" },
          transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
        }
      ],
      transformProfiles: []
    })

    setup.service.receive(event(127))
    setup.service.configure({ bindings: [], transformProfiles: [] })
    await flushContinuous()

    expect(setup.applyMixerControl).not.toHaveBeenCalled()
    expect(setup.markDirty).not.toHaveBeenCalled()
  })

  it("does not cache a boolean value when the target disappears before apply", async () => {
    const setup = harness({
      bindings: [
        {
          id: "solo",
          address: { ...address, type: "note", number: 60 },
          input: { type: "note" },
          target: { type: "mixer", channelIndex: 0, parameter: "solo", behavior: "toggle" }
        }
      ],
      transformProfiles: []
    })
    setup.applyMixerControl.mockResolvedValueOnce(false).mockResolvedValueOnce(undefined)

    setup.service.receive({ ...event(127), type: "note", number: 60 })
    await Promise.resolve()
    setup.service.receive({ ...event(127, 2), type: "note", number: 60 })
    await Promise.resolve()

    expect(setup.applyMixerControl.mock.calls).toEqual([
      ["audio-1", "soloed", true],
      ["audio-1", "soloed", true]
    ])
    expect(setup.markDirty).toHaveBeenCalledOnce()
  })
})
