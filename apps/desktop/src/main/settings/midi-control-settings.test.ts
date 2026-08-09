import { describe, expect, it } from "vitest"
import { BUILTIN_MIDI_TRANSFORM_PROFILE_IDS } from "@heron/contracts"
import {
  recoverMidiControlPreferences,
  validateMidiControlPreferences
} from "./midi-control-settings"

const address = {
  portId: "controller",
  portName: "Controller",
  channel: 0,
  type: "control-change",
  number: 7
}

describe("MIDI control settings", () => {
  it("recovers valid fan-out bindings while isolating a corrupt entry", () => {
    const recovered = recoverMidiControlPreferences({
      transformProfiles: [],
      bindings: [
        {
          id: "command",
          address,
          input: { type: "absolute" },
          target: { type: "application-command", command: "transport.toggle-playback" }
        },
        {
          id: "gain",
          address,
          input: { type: "absolute" },
          target: { type: "mixer", channelIndex: 0, parameter: "gain" },
          transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.dawFader
        },
        { id: "broken", address: { ...address, channel: 99 } }
      ]
    })
    expect(recovered.bindings.map((binding) => binding.id)).toEqual(["command", "gain"])
  })

  it("rejects built-in profile replacement and deleting a referenced user profile", () => {
    expect(() =>
      validateMidiControlPreferences({
        bindings: [],
        transformProfiles: [
          {
            id: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear,
            name: "Shadow",
            type: "absolute",
            segments: [{ inputStart: 0, inputEnd: 1, outputStart: 0, outputEnd: 1, kind: "linear" }]
          }
        ]
      })
    ).toThrow("shadows a built-in")

    expect(() =>
      validateMidiControlPreferences({
        transformProfiles: [],
        bindings: [
          {
            id: "gain",
            address,
            input: { type: "absolute" },
            target: { type: "mixer", channelIndex: 0, parameter: "gain" },
            transformProfileId: "user:deleted"
          }
        ]
      })
    ).toThrow("incompatible transform profile")
  })

  it("parses every supported target, decoder, segment kind, and sorted acceleration profile", () => {
    const result = validateMidiControlPreferences({
      transformProfiles: [
        {
          id: "absolute:custom",
          name: "Custom curve",
          type: "absolute",
          segments: [
            {
              inputStart: 0.5,
              inputEnd: 1,
              outputStart: 0.8,
              outputEnd: 0,
              kind: "step",
              amount: 2
            },
            {
              inputStart: 0,
              inputEnd: 0.1,
              outputStart: 0,
              outputEnd: 0.2,
              kind: "exponential"
            },
            {
              inputStart: 0.1,
              inputEnd: 0.2,
              outputStart: 0.2,
              outputEnd: 0.4,
              kind: "logarithmic"
            },
            {
              inputStart: 0.2,
              inputEnd: 0.3,
              outputStart: 0.4,
              outputEnd: 0.6,
              kind: "s-curve"
            },
            {
              inputStart: 0.3,
              inputEnd: 0.5,
              outputStart: 0.6,
              outputEnd: 0.8,
              kind: "linear"
            }
          ]
        },
        {
          id: "relative:custom",
          name: "Custom encoder",
          type: "relative",
          baseStep: 0.01,
          acceleration: [
            { eventsPerSecond: 20, multiplier: 3 },
            { eventsPerSecond: 5, multiplier: 1.5 }
          ]
        }
      ],
      bindings: [
        {
          id: "note-command",
          address: { ...address, type: "note" },
          input: { type: "note" },
          target: { type: "application-command", command: "project.save" }
        },
        {
          id: "relative-plugin",
          address,
          input: { type: "relative", encoding: "twos-complement" },
          target: {
            type: "plugin-parameter",
            controlAlias: "lead.synth_1",
            parameterKey: "vst3:cutoff"
          },
          transformProfileId: "relative:custom"
        },
        {
          id: "mute",
          address,
          input: { type: "absolute" },
          target: { type: "mixer", channelIndex: 4, parameter: "mute", behavior: "absolute" }
        },
        {
          id: "pan",
          address,
          input: { type: "absolute" },
          target: { type: "mixer", channelIndex: 1, parameter: "pan" },
          transformProfileId: "absolute:custom"
        }
      ]
    })

    const absoluteProfile = result.transformProfiles.find((profile) => profile.type === "absolute")
    const relativeProfile = result.transformProfiles.find((profile) => profile.type === "relative")
    expect(absoluteProfile?.segments.map((segment) => segment.inputStart)).toEqual([
      0, 0.1, 0.2, 0.3, 0.5
    ])
    expect(relativeProfile).toMatchObject({
      acceleration: [
        { eventsPerSecond: 5, multiplier: 1.5 },
        { eventsPerSecond: 20, multiplier: 3 }
      ]
    })
    expect(result.bindings).toHaveLength(4)
  })

  it("returns empty preferences for malformed legacy roots", () => {
    expect(recoverMidiControlPreferences(null)).toEqual({ bindings: [], transformProfiles: [] })
    expect(recoverMidiControlPreferences([])).toEqual({ bindings: [], transformProfiles: [] })
    expect(recoverMidiControlPreferences({ bindings: null, transformProfiles: [] })).toEqual({
      bindings: [],
      transformProfiles: []
    })
    expect(() => validateMidiControlPreferences(null)).toThrow("must be an object")
    expect(() => validateMidiControlPreferences({ bindings: [], transformProfiles: null })).toThrow(
      "must be arrays"
    )
  })

  it("rejects duplicate identifiers and malformed addresses, input modes, and targets", () => {
    const validBinding = {
      id: "binding",
      address,
      input: { type: "absolute" },
      target: { type: "application-command", command: "project.save" }
    }
    const invalidBindings = [
      { ...validBinding, id: "" },
      { ...validBinding, address: null },
      { ...validBinding, address: { ...address, type: "pitch-bend" } },
      { ...validBinding, address: { ...address, portId: "" } },
      { ...validBinding, address: { ...address, channel: 0.5 } },
      { ...validBinding, address: { ...address, number: Number.NaN } },
      { ...validBinding, input: null },
      { ...validBinding, input: { type: "relative", encoding: "mystery" } },
      { ...validBinding, target: { type: "application-command", command: "missing.command" } },
      { ...validBinding, target: { type: "mixer", channelIndex: -1, parameter: "gain" } },
      { ...validBinding, target: { type: "mixer", channelIndex: 0, parameter: "mute" } },
      {
        ...validBinding,
        target: { type: "plugin-parameter", controlAlias: "Bad Alias", parameterKey: "cutoff" }
      },
      {
        ...validBinding,
        target: {
          type: "plugin-parameter",
          controlAlias: "a".repeat(65),
          parameterKey: "cutoff"
        }
      },
      {
        ...validBinding,
        target: { type: "plugin-parameter", controlAlias: "lead", parameterKey: "" }
      },
      { ...validBinding, target: { type: "unknown" } },
      { ...validBinding, transformProfileId: "" }
    ]

    for (const binding of invalidBindings) {
      expect(() =>
        validateMidiControlPreferences({ bindings: [binding], transformProfiles: [] })
      ).toThrow()
    }
    expect(() =>
      validateMidiControlPreferences({
        bindings: [validBinding, structuredClone(validBinding)],
        transformProfiles: []
      })
    ).toThrow("Duplicate MIDI control binding")
  })

  it("rejects malformed absolute and relative transform profiles", () => {
    const absolute = {
      id: "absolute:bad",
      name: "Bad",
      type: "absolute",
      segments: [{ inputStart: 0, inputEnd: 1, outputStart: 0, outputEnd: 1, kind: "linear" }]
    }
    const invalidProfiles = [
      null,
      { ...absolute, id: "" },
      { ...absolute, type: "mystery" },
      { ...absolute, segments: [] },
      { ...absolute, segments: [{ ...absolute.segments[0], kind: "bezier" }] },
      { ...absolute, segments: [{ ...absolute.segments[0], inputEnd: 0 }] },
      { ...absolute, segments: [{ ...absolute.segments[0], inputStart: 0.1 }] },
      {
        ...absolute,
        segments: [
          { ...absolute.segments[0], inputEnd: 0.4 },
          { ...absolute.segments[0], inputStart: 0.5 }
        ]
      },
      { ...absolute, segments: [{ ...absolute.segments[0], amount: 33 }] },
      { id: "relative:bad", name: "Bad", type: "relative", baseStep: 0.01, acceleration: null },
      {
        id: "relative:bad",
        name: "Bad",
        type: "relative",
        baseStep: 0,
        acceleration: []
      },
      {
        id: "relative:bad",
        name: "Bad",
        type: "relative",
        baseStep: 0.01,
        acceleration: [
          { eventsPerSecond: 5, multiplier: 1 },
          { eventsPerSecond: 5, multiplier: 2 }
        ]
      }
    ]

    for (const profile of invalidProfiles) {
      expect(() =>
        validateMidiControlPreferences({ bindings: [], transformProfiles: [profile] })
      ).toThrow()
    }
    expect(() =>
      validateMidiControlPreferences({
        bindings: [],
        transformProfiles: [
          { id: "duplicate", name: "One", type: "relative", baseStep: 0.01, acceleration: [] },
          { id: "duplicate", name: "Two", type: "relative", baseStep: 0.02, acceleration: [] }
        ]
      })
    ).toThrow("Duplicate MIDI transform profile")
  })
})
