import { describe, expect, it } from "vitest"
import {
  BUILTIN_MIDI_TRANSFORM_PROFILES,
  BUILTIN_MIDI_TRANSFORM_PROFILE_IDS,
  decodeRelativeMidiValue,
  evaluateAbsoluteMidiTransform,
  evaluateRelativeMidiTransform,
  isContinuousMidiControlTarget,
  midiControlAddressKey,
  midiBindingCompatibilityError,
  midiTransformProfile
} from "./midi-control"
import type { MidiControlBinding, MidiControlPreferences } from "./midi-control"

const address = {
  portId: "controller-1",
  portName: "Controller",
  channel: 0,
  type: "control-change" as const,
  number: 7
}

function binding(overrides: Partial<MidiControlBinding> = {}): MidiControlBinding {
  return {
    id: "binding-1",
    address,
    input: { type: "absolute" },
    target: { type: "mixer", channelIndex: 0, parameter: "gain" },
    transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear,
    ...overrides
  }
}

describe("MIDI control transforms", () => {
  it("evaluates every absolute MIDI value through the linear profile", () => {
    const profile = BUILTIN_MIDI_TRANSFORM_PROFILES.find(
      (candidate) => candidate.id === BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
    )
    expect(profile?.type).toBe("absolute")
    if (!profile || profile.type !== "absolute") throw new Error("linear profile missing")
    for (let value = 0; value <= 127; value += 1) {
      expect(evaluateAbsoluteMidiTransform(profile, value / 127)).toBeCloseTo(value / 127)
    }
  })

  it("supports reverse, discontinuous, and step segments", () => {
    const profile = {
      id: "user:split",
      name: "Split",
      type: "absolute" as const,
      segments: [
        { inputStart: 0, inputEnd: 0.5, outputStart: 1, outputEnd: 0.5, kind: "linear" as const },
        { inputStart: 0.5, inputEnd: 1, outputStart: 0.25, outputEnd: 0.75, kind: "step" as const }
      ]
    }
    expect(evaluateAbsoluteMidiTransform(profile, 0)).toBe(1)
    expect(evaluateAbsoluteMidiTransform(profile, 0.5)).toBe(0.25)
    expect(evaluateAbsoluteMidiTransform(profile, 1)).toBe(0.75)
  })

  it("decodes supported relative encodings", () => {
    expect(decodeRelativeMidiValue(1, "one-127")).toBe(1)
    expect(decodeRelativeMidiValue(127, "one-127")).toBe(-1)
    expect(decodeRelativeMidiValue(2, "one-127")).toBe(0)
    expect(decodeRelativeMidiValue(63, "twos-complement")).toBe(63)
    expect(decodeRelativeMidiValue(65, "twos-complement")).toBe(-63)
    expect(decodeRelativeMidiValue(63, "binary-offset")).toBe(-1)
    expect(decodeRelativeMidiValue(65, "binary-offset")).toBe(1)
    for (const encoding of ["one-127", "twos-complement", "binary-offset"] as const) {
      expect(decodeRelativeMidiValue(0, encoding)).toBe(0)
      expect(decodeRelativeMidiValue(64, encoding)).toBe(0)
    }
  })

  it("applies relative base step and acceleration", () => {
    expect(
      evaluateRelativeMidiTransform(
        {
          id: "user:fast",
          name: "Fast",
          type: "relative",
          baseStep: 0.01,
          acceleration: [
            { eventsPerSecond: 0, multiplier: 1 },
            { eventsPerSecond: 20, multiplier: 3 }
          ]
        },
        -2,
        10
      )
    ).toBeCloseTo(-0.04)
  })

  it("protects built-in profile ids from user shadowing", () => {
    const preferences: MidiControlPreferences = {
      bindings: [],
      transformProfiles: [
        {
          id: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear,
          name: "Shadow",
          type: "relative",
          baseStep: 0.5,
          acceleration: []
        }
      ]
    }
    expect(midiTransformProfile(preferences, BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear)?.name).toBe(
      "Linear"
    )
  })

  it("uses stable address keys and resolves user profiles", () => {
    expect(midiControlAddressKey(address)).toBe('["controller-1",0,"control-change",7]')
    const custom = {
      id: "user:custom",
      name: "Custom",
      type: "relative" as const,
      baseStep: 0.01,
      acceleration: []
    }
    expect(midiTransformProfile({ bindings: [], transformProfiles: [custom] }, custom.id)).toBe(
      custom
    )
    expect(
      isContinuousMidiControlTarget({
        type: "plugin-parameter",
        controlAlias: "a",
        parameterKey: "b"
      })
    ).toBe(true)
    expect(
      isContinuousMidiControlTarget({
        type: "mixer",
        channelIndex: 0,
        parameter: "mute",
        behavior: "toggle"
      })
    ).toBe(false)
  })

  it("evaluates exponential and logarithmic shapes including neutral amounts", () => {
    const shaped = (kind: "exponential" | "logarithmic", amount?: number) => ({
      id: `${kind}:${amount}`,
      name: kind,
      type: "absolute" as const,
      segments: [
        {
          inputStart: 0,
          inputEnd: 1,
          outputStart: 0,
          outputEnd: 1,
          kind,
          ...(amount === undefined ? {} : { amount })
        }
      ]
    })

    expect(evaluateAbsoluteMidiTransform(shaped("exponential"), 0.5)).toBeGreaterThan(0)
    expect(evaluateAbsoluteMidiTransform(shaped("exponential", 0), 0.5)).toBe(0.5)
    expect(evaluateAbsoluteMidiTransform(shaped("logarithmic", 2), 0.5)).toBeGreaterThan(0.5)
    expect(evaluateAbsoluteMidiTransform(shaped("logarithmic", 0), 0.5)).toBe(0.5)
    expect(evaluateAbsoluteMidiTransform(shaped("logarithmic", -2), 0.5)).toBeGreaterThan(0)
  })

  it("uses the last acceleration multiplier above the configured range", () => {
    expect(
      evaluateRelativeMidiTransform(
        {
          id: "relative:fast",
          name: "Fast",
          type: "relative",
          baseStep: 0.01,
          acceleration: [
            { eventsPerSecond: 5, multiplier: 1 },
            { eventsPerSecond: 10, multiplier: 4 }
          ]
        },
        1,
        100
      )
    ).toBe(0.04)
  })
})

describe("MIDI binding compatibility", () => {
  it("accepts continuous absolute and relative targets", () => {
    expect(midiBindingCompatibilityError(binding())).toBeNull()
    expect(
      midiBindingCompatibilityError(binding({ input: { type: "relative", encoding: "one-127" } }))
    ).toBeNull()
  })

  it("rejects relative discrete targets and note continuous targets", () => {
    expect(
      midiBindingCompatibilityError(
        binding({
          input: { type: "relative", encoding: "one-127" },
          target: { type: "application-command", command: "transport.toggle-playback" },
          transformProfileId: undefined
        })
      )
    ).toContain("continuous")
    expect(
      midiBindingCompatibilityError(
        binding({
          address: { ...address, type: "note" },
          input: { type: "note" }
        })
      )
    ).toContain("Note input")
  })

  it("reports every discrete/continuous profile and address mismatch", () => {
    expect(
      midiBindingCompatibilityError(
        binding({
          address: { ...address, type: "note" },
          input: { type: "note" },
          target: { type: "application-command", command: "project.save" }
        })
      )
    ).toContain("cannot reference")
    expect(
      midiBindingCompatibilityError(
        binding({
          input: { type: "note" },
          target: { type: "application-command", command: "project.save" },
          transformProfileId: undefined
        })
      )
    ).toContain("cannot use note")
    expect(midiBindingCompatibilityError(binding({ transformProfileId: undefined }))).toContain(
      "require a transform"
    )
    expect(
      midiBindingCompatibilityError(
        binding({
          target: { type: "application-command", command: "project.save" }
        })
      )
    ).toContain("Discrete MIDI bindings")
  })
})
