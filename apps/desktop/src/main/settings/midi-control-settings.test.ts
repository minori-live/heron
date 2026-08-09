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
})
