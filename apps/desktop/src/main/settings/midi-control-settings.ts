import {
  APPLICATION_COMMAND_IDS,
  BUILTIN_MIDI_TRANSFORM_PROFILES,
  midiBindingCompatibilityError,
  midiTransformProfile
} from "@heron/contracts"
import type {
  MidiAbsoluteSegmentKind,
  MidiAbsoluteTransformProfile,
  MidiControlAddress,
  MidiControlBinding,
  MidiControlInputMode,
  MidiControlPreferences,
  MidiControlTarget,
  MidiRelativeTransformProfile,
  MidiTransformProfile
} from "@heron/contracts"

const SEGMENT_KINDS = new Set<MidiAbsoluteSegmentKind>([
  "linear",
  "exponential",
  "logarithmic",
  "s-curve",
  "step"
])
const BUILTIN_IDS = new Set(BUILTIN_MIDI_TRANSFORM_PROFILES.map((profile) => profile.id))
const CONTROL_ALIAS = /^[a-z0-9][a-z0-9._-]*$/u

export function validateMidiControlPreferences(value: unknown): MidiControlPreferences {
  return parsePreferences(value, false)
}

export function recoverMidiControlPreferences(value: unknown): MidiControlPreferences {
  return parsePreferences(value, true)
}

function parsePreferences(value: unknown, tolerant: boolean): MidiControlPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (tolerant) return { bindings: [], transformProfiles: [] }
    throw new TypeError("MIDI control preferences must be an object")
  }
  const input = value as { bindings?: unknown; transformProfiles?: unknown }
  if (!Array.isArray(input.bindings) || !Array.isArray(input.transformProfiles)) {
    if (tolerant) return { bindings: [], transformProfiles: [] }
    throw new TypeError("MIDI control bindings and transform profiles must be arrays")
  }
  const transformProfiles = parseItems(input.transformProfiles, parseProfile, tolerant)
  const profileIds = new Set<string>()
  for (const profile of transformProfiles) {
    if (BUILTIN_IDS.has(profile.id)) {
      if (tolerant) continue
      throw new TypeError(`MIDI transform profile '${profile.id}' shadows a built-in profile`)
    }
    if (profileIds.has(profile.id)) {
      if (tolerant) continue
      throw new TypeError(`Duplicate MIDI transform profile '${profile.id}'`)
    }
    profileIds.add(profile.id)
  }
  const uniqueProfiles = transformProfiles.filter(
    (profile, index) =>
      !BUILTIN_IDS.has(profile.id) &&
      transformProfiles.findIndex((candidate) => candidate.id === profile.id) === index
  )
  const candidate = {
    bindings: [],
    transformProfiles: uniqueProfiles
  } satisfies MidiControlPreferences
  const bindings = parseItems(input.bindings, parseBinding, tolerant).filter(
    (binding, index, all) => {
      if (all.findIndex((candidateBinding) => candidateBinding.id === binding.id) !== index) {
        if (!tolerant) throw new TypeError(`Duplicate MIDI control binding '${binding.id}'`)
        return false
      }
      const compatibility = midiBindingCompatibilityError(binding)
      if (compatibility) {
        if (!tolerant) throw new TypeError(compatibility)
        return false
      }
      if (binding.transformProfileId) {
        const profile = midiTransformProfile(candidate, binding.transformProfileId)
        if (!profile || profile.type !== binding.input.type) {
          if (!tolerant) {
            throw new TypeError(
              `MIDI binding '${binding.id}' references an incompatible transform profile`
            )
          }
          return false
        }
      }
      return true
    }
  )
  return { bindings, transformProfiles: uniqueProfiles }
}

function parseItems<T>(values: unknown[], parser: (value: unknown) => T, tolerant: boolean): T[] {
  const parsed: T[] = []
  for (const value of values) {
    try {
      parsed.push(parser(value))
    } catch (error) {
      if (!tolerant) throw error
    }
  }
  return parsed
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be text`)
  return value.trim()
}

function finite(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be from ${minimum} through ${maximum}`)
  }
  return value
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  const parsed = finite(value, minimum, maximum, label)
  if (!Number.isInteger(parsed)) throw new TypeError(`${label} must be an integer`)
  return parsed
}

function parseAddress(value: unknown): MidiControlAddress {
  const input = record(value, "MIDI control address")
  const type = input.type
  if (type !== "note" && type !== "control-change") {
    throw new TypeError("Unsupported MIDI control message type")
  }
  return {
    portId: nonEmptyString(input.portId, "MIDI port ID"),
    portName: nonEmptyString(input.portName, "MIDI port name"),
    channel: integer(input.channel, 0, 15, "MIDI channel"),
    type,
    number: integer(input.number, 0, 127, "MIDI message number")
  }
}

function parseInput(value: unknown): MidiControlInputMode {
  const input = record(value, "MIDI input mode")
  if (input.type === "note" || input.type === "absolute") return { type: input.type }
  if (
    input.type === "relative" &&
    (input.encoding === "one-127" ||
      input.encoding === "twos-complement" ||
      input.encoding === "binary-offset")
  ) {
    return { type: "relative", encoding: input.encoding }
  }
  throw new TypeError("Unsupported MIDI control input mode")
}

function parseTarget(value: unknown): MidiControlTarget {
  const input = record(value, "MIDI control target")
  if (
    input.type === "application-command" &&
    typeof input.command === "string" &&
    APPLICATION_COMMAND_IDS.includes(input.command as never)
  ) {
    return { type: "application-command", command: input.command as never }
  }
  if (input.type === "mixer") {
    const channelIndex = integer(input.channelIndex, 0, 4095, "Mixer control channel index")
    if (input.parameter === "gain" || input.parameter === "pan") {
      return { type: "mixer", channelIndex, parameter: input.parameter }
    }
    if (
      (input.parameter === "mute" || input.parameter === "solo") &&
      (input.behavior === "toggle" || input.behavior === "absolute")
    ) {
      return { type: "mixer", channelIndex, parameter: input.parameter, behavior: input.behavior }
    }
  }
  if (input.type === "plugin-parameter") {
    const controlAlias = nonEmptyString(input.controlAlias, "Plug-in control alias")
    if (new TextEncoder().encode(controlAlias).length > 64 || !CONTROL_ALIAS.test(controlAlias)) {
      throw new TypeError("Plug-in control alias must be a lowercase slug up to 64 bytes")
    }
    return {
      type: "plugin-parameter",
      controlAlias,
      parameterKey: nonEmptyString(input.parameterKey, "Plug-in parameter key")
    }
  }
  throw new TypeError("Unsupported MIDI control target")
}

function parseBinding(value: unknown): MidiControlBinding {
  const input = record(value, "MIDI control binding")
  return {
    id: nonEmptyString(input.id, "MIDI control binding ID"),
    address: parseAddress(input.address),
    input: parseInput(input.input),
    target: parseTarget(input.target),
    ...(input.transformProfileId === undefined
      ? {}
      : { transformProfileId: nonEmptyString(input.transformProfileId, "Transform profile ID") })
  }
}

function parseProfile(value: unknown): MidiTransformProfile {
  const input = record(value, "MIDI transform profile")
  const common = {
    id: nonEmptyString(input.id, "MIDI transform profile ID"),
    name: nonEmptyString(input.name, "MIDI transform profile name")
  }
  if (input.type === "absolute") return parseAbsoluteProfile(common, input)
  if (input.type === "relative") return parseRelativeProfile(common, input)
  throw new TypeError("Unsupported MIDI transform profile type")
}

function parseAbsoluteProfile(
  common: { id: string; name: string },
  input: Record<string, unknown>
): MidiAbsoluteTransformProfile {
  if (!Array.isArray(input.segments) || input.segments.length === 0) {
    throw new TypeError("Absolute MIDI transform profiles require segments")
  }
  const segments = input.segments.map((value) => {
    const segment = record(value, "MIDI transform segment")
    if (!SEGMENT_KINDS.has(segment.kind as MidiAbsoluteSegmentKind)) {
      throw new TypeError("Unsupported MIDI transform segment kind")
    }
    const parsed = {
      inputStart: finite(segment.inputStart, 0, 1, "Segment input start"),
      inputEnd: finite(segment.inputEnd, 0, 1, "Segment input end"),
      outputStart: finite(segment.outputStart, 0, 1, "Segment output start"),
      outputEnd: finite(segment.outputEnd, 0, 1, "Segment output end"),
      kind: segment.kind as MidiAbsoluteSegmentKind,
      ...(segment.amount === undefined
        ? {}
        : { amount: finite(segment.amount, -32, 32, "Segment amount") })
    }
    if (parsed.inputEnd <= parsed.inputStart)
      throw new TypeError("MIDI transform segments are empty")
    return parsed
  })
  const sorted = [...segments].sort((left, right) => left.inputStart - right.inputStart)
  if (sorted[0]!.inputStart !== 0 || sorted.at(-1)!.inputEnd !== 1) {
    throw new TypeError("Absolute MIDI transform segments must cover 0 through 1")
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]!.inputEnd !== sorted[index]!.inputStart) {
      throw new TypeError("Absolute MIDI transform segments cannot overlap or leave gaps")
    }
  }
  return { ...common, type: "absolute", segments: sorted }
}

function parseRelativeProfile(
  common: { id: string; name: string },
  input: Record<string, unknown>
): MidiRelativeTransformProfile {
  if (!Array.isArray(input.acceleration)) {
    throw new TypeError("Relative MIDI transform acceleration must be an array")
  }
  const acceleration = input.acceleration
    .map((value) => {
      const point = record(value, "Relative acceleration point")
      return {
        eventsPerSecond: finite(point.eventsPerSecond, 0, 10_000, "Acceleration event rate"),
        multiplier: finite(point.multiplier, Number.EPSILON, 1_000, "Acceleration multiplier")
      }
    })
    .sort((left, right) => left.eventsPerSecond - right.eventsPerSecond)
  if (
    acceleration.some(
      (point, index) =>
        index > 0 && point.eventsPerSecond === acceleration[index - 1]!.eventsPerSecond
    )
  ) {
    throw new TypeError("Relative acceleration event rates must be unique")
  }
  return {
    ...common,
    type: "relative",
    baseStep: finite(input.baseStep, Number.EPSILON, 1, "Relative MIDI base step"),
    acceleration
  }
}
