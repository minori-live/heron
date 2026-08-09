import type {
  KeySignatureEventState,
  KeySignatureMode,
  MidiActiveNote,
  MixerChannelState
} from "@heron/contracts"

type CoreQuality = "major" | "minor" | "diminished" | "other"

interface ChordTemplate {
  suffix: string
  intervals: readonly number[]
  coreQuality: CoreQuality
}

interface ChordCandidate {
  root: number
  template: ChordTemplate
  templateIndex: number
}

const CHORD_TEMPLATES: readonly ChordTemplate[] = [
  { suffix: "", intervals: [0, 4, 7], coreQuality: "major" },
  { suffix: "m", intervals: [0, 3, 7], coreQuality: "minor" },
  { suffix: "dim", intervals: [0, 3, 6], coreQuality: "diminished" },
  { suffix: "aug", intervals: [0, 4, 8], coreQuality: "other" },
  { suffix: "sus2", intervals: [0, 2, 7], coreQuality: "other" },
  { suffix: "sus4", intervals: [0, 5, 7], coreQuality: "other" },
  { suffix: "6", intervals: [0, 4, 7, 9], coreQuality: "major" },
  { suffix: "m6", intervals: [0, 3, 7, 9], coreQuality: "minor" },
  { suffix: "7", intervals: [0, 4, 7, 10], coreQuality: "major" },
  { suffix: "maj7", intervals: [0, 4, 7, 11], coreQuality: "major" },
  { suffix: "m7", intervals: [0, 3, 7, 10], coreQuality: "minor" },
  { suffix: "mMaj7", intervals: [0, 3, 7, 11], coreQuality: "minor" },
  { suffix: "dim7", intervals: [0, 3, 6, 9], coreQuality: "diminished" },
  { suffix: "m7♭5", intervals: [0, 3, 6, 10], coreQuality: "diminished" },
  { suffix: "add9", intervals: [0, 2, 4, 7], coreQuality: "major" },
  { suffix: "madd9", intervals: [0, 2, 3, 7], coreQuality: "minor" },
  { suffix: "6/9", intervals: [0, 2, 4, 7, 9], coreQuality: "major" },
  { suffix: "m6/9", intervals: [0, 2, 3, 7, 9], coreQuality: "minor" },
  { suffix: "9", intervals: [0, 2, 4, 7, 10], coreQuality: "major" },
  { suffix: "maj9", intervals: [0, 2, 4, 7, 11], coreQuality: "major" },
  { suffix: "m9", intervals: [0, 2, 3, 7, 10], coreQuality: "minor" },
  { suffix: "11", intervals: [0, 2, 4, 5, 7, 10], coreQuality: "major" },
  { suffix: "m11", intervals: [0, 2, 3, 5, 7, 10], coreQuality: "minor" },
  { suffix: "13", intervals: [0, 2, 4, 5, 7, 9, 10], coreQuality: "major" },
  { suffix: "maj13", intervals: [0, 2, 4, 5, 7, 9, 11], coreQuality: "major" },
  { suffix: "m13", intervals: [0, 2, 3, 5, 7, 9, 10], coreQuality: "minor" }
]

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const
const MAJOR_QUALITIES: readonly CoreQuality[] = [
  "major",
  "minor",
  "minor",
  "major",
  "major",
  "minor",
  "diminished"
]
const MINOR_QUALITIES: readonly CoreQuality[] = [
  "minor",
  "diminished",
  "major",
  "minor",
  "minor",
  "major",
  "major"
]
const NATURAL_PITCHES = [0, 2, 4, 5, 7, 9, 11] as const
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6] as const
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3] as const
const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]

function normalizePitch(value: number): number {
  return ((value % 12) + 12) % 12
}

function pitchMask(pitches: readonly number[]): number {
  return pitches.reduce((mask, pitch) => mask | (1 << normalizePitch(pitch)), 0)
}

function templateMask(root: number, template: ChordTemplate): number {
  return pitchMask(template.intervals.map((interval) => root + interval))
}

function tonicPitch(signature: KeySignatureEventState): number {
  const majorTonic = normalizePitch(signature.fifths * 7)
  return signature.mode === "minor" ? normalizePitch(majorTonic + 9) : majorTonic
}

function scaleFor(mode: KeySignatureMode): readonly number[] {
  return mode === "minor" ? MINOR_SCALE : MAJOR_SCALE
}

function qualitiesFor(mode: KeySignatureMode): readonly CoreQuality[] {
  return mode === "minor" ? MINOR_QUALITIES : MAJOR_QUALITIES
}

function contextualRank(candidate: ChordCandidate, signature: KeySignatureEventState): number {
  const tonic = tonicPitch(signature)
  if (candidate.root === tonic) return 0
  const degree = scaleFor(signature.mode).findIndex(
    (interval) => normalizePitch(tonic + interval) === candidate.root
  )
  if (degree < 0 || qualitiesFor(signature.mode)[degree] !== candidate.template.coreQuality)
    return 5
  if (degree === 4) return 1
  if (degree === 3) return 2
  return 3
}

function keySignatureSpellings(signature: KeySignatureEventState): ReadonlyMap<number, string> {
  const accidentals = [0, 0, 0, 0, 0, 0, 0]
  const order = signature.fifths < 0 ? FLAT_ORDER : SHARP_ORDER
  const accidental = signature.fifths < 0 ? -1 : 1
  for (let index = 0; index < Math.abs(signature.fifths); index += 1) {
    const letter = order[index]
    if (letter !== undefined) accidentals[letter] = accidental
  }
  return new Map(
    LETTERS.map((letter, index) => {
      const amount = accidentals[index] ?? 0
      const suffix = amount < 0 ? "♭" : amount > 0 ? "♯" : ""
      return [normalizePitch((NATURAL_PITCHES[index] ?? 0) + amount), `${letter}${suffix}`]
    })
  )
}

function spellPitch(pitch: number, signature: KeySignatureEventState): string {
  const normalized = normalizePitch(pitch)
  return (
    keySignatureSpellings(signature).get(normalized) ??
    (signature.fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[normalized] ??
    ""
  )
}

function routeMatches(note: MidiActiveNote, channel: MixerChannelState): boolean {
  if (
    channel.kind !== "instrument" ||
    channel.systemRole !== null ||
    (!channel.inputMonitoring && !channel.recordArmed)
  ) {
    return false
  }
  const route = channel.midiInput
  return (
    (route?.portId === null || route?.portId === undefined || route.portId === note.portId) &&
    (route?.channel === null || route?.channel === undefined || route.channel === note.channel)
  )
}

export function routedMidiKeys(
  notes: readonly MidiActiveNote[],
  channels: readonly MixerChannelState[]
): number[] {
  return [
    ...new Set(
      notes
        .filter((note) => channels.some((channel) => routeMatches(note, channel)))
        .map((note) => note.key)
    )
  ].sort((left, right) => left - right)
}

export function recognizeMidiChord(
  keys: readonly number[],
  signature: KeySignatureEventState
): string | null {
  const pitchClasses = [...new Set(keys.map(normalizePitch))]
  if (pitchClasses.length < 3) return null
  const mask = pitchMask(pitchClasses)
  const candidates: ChordCandidate[] = []
  CHORD_TEMPLATES.forEach((template, templateIndex) => {
    for (let root = 0; root < 12; root += 1) {
      if (templateMask(root, template) === mask) candidates.push({ root, template, templateIndex })
    }
  })
  const tonic = tonicPitch(signature)
  candidates.sort(
    (left, right) =>
      contextualRank(left, signature) - contextualRank(right, signature) ||
      left.templateIndex - right.templateIndex ||
      normalizePitch(left.root - tonic) - normalizePitch(right.root - tonic)
  )
  const selected = candidates[0]
  return selected ? `${spellPitch(selected.root, signature)}${selected.template.suffix}` : null
}
