import { describe, expect, it } from "vitest"
import type { KeySignatureEventState, MidiActiveNote, MixerChannelState } from "@heron/contracts"
import { recognizeMidiChord, routedMidiKeys } from "./midiChordRecognition"

const cMajor: KeySignatureEventState = { tick: 0, fifths: 0, mode: "major" }
const aMinor: KeySignatureEventState = { tick: 0, fifths: 0, mode: "minor" }

function instrument(overrides: Partial<MixerChannelState> = {}): MixerChannelState {
  return {
    id: "instrument",
    kind: "instrument",
    systemRole: null,
    name: "Instrument",
    color: "#000000",
    sortOrder: 0,
    inputSource: null,
    inputFormat: null,
    midiInput: { portId: "keyboard", portName: "Keyboard", channel: 1 },
    gainDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    outputChannelId: null,
    recordArmed: false,
    inputMonitoring: true,
    inputChannels: [],
    hardwareOutputChannels: [],
    ...overrides
  }
}

function note(portId: string, channel: number, key: number): MidiActiveNote {
  return { portId, channel, key }
}

describe("recognizeMidiChord", () => {
  it("recognizes exact pitch-class sets without considering inversion or octave duplication", () => {
    expect(recognizeMidiChord([64, 67, 72, 84], cMajor)).toBe("C")
    expect(recognizeMidiChord([55, 60, 64], cMajor)).toBe("C")
  })

  it("uses the current mode to resolve C6 and Am7", () => {
    const keys = [60, 64, 67, 69]

    expect(recognizeMidiChord(keys, cMajor)).toBe("C6")
    expect(recognizeMidiChord(keys, aMinor)).toBe("Am7")
  })

  it("spells roots from sharp and flat key signatures", () => {
    expect(recognizeMidiChord([61, 65, 68], { tick: 0, fifths: 7, mode: "major" })).toBe("C♯")
    expect(recognizeMidiChord([61, 65, 68], { tick: 0, fifths: -5, mode: "major" })).toBe("D♭")
  })

  it("covers exact common extensions and rejects incomplete variants", () => {
    expect(recognizeMidiChord([60, 62, 64, 65, 67, 69, 70], cMajor)).toBe("C13")
    expect(recognizeMidiChord([60, 62, 64, 67, 69, 70], cMajor)).toBeNull()
  })

  it("stays blank for fewer than three pitch classes and unknown clusters", () => {
    expect(recognizeMidiChord([60, 67], cMajor)).toBeNull()
    expect(recognizeMidiChord([60, 61, 62], cMajor)).toBeNull()
  })
})

describe("routedMidiKeys", () => {
  const notes = [
    note("keyboard", 1, 60),
    note("keyboard", 2, 64),
    note("pads", 1, 67),
    note("clock", 1, 71)
  ]

  it("uses only notes matching monitored or armed instrument routes", () => {
    const channels = [
      instrument(),
      instrument({
        id: "pads",
        inputMonitoring: false,
        recordArmed: true,
        midiInput: { portId: "pads", portName: "Pads", channel: null }
      })
    ]

    expect(routedMidiKeys(notes, channels)).toEqual([60, 67])
  })

  it("treats an unscoped active route as all ports and channels", () => {
    expect(routedMidiKeys(notes, [instrument({ midiInput: null })])).toEqual([60, 64, 67, 71])
  })

  it("ignores inactive tracks and system instruments", () => {
    expect(
      routedMidiKeys(notes, [
        instrument({ inputMonitoring: false, recordArmed: false }),
        instrument({ id: "metronome", systemRole: "metronome" })
      ])
    ).toEqual([])
  })
})
