import type { ApplicationCommandId } from "./application"

export const BUILTIN_MIDI_TRANSFORM_PROFILE_IDS = {
  linear: "builtin:absolute-linear",
  dawFader: "builtin:absolute-daw-fader",
  reverseLinear: "builtin:absolute-reverse-linear",
  relativeNormal: "builtin:relative-normal",
  relativeFine: "builtin:relative-fine"
} as const

export type MidiControlMessageType = "note" | "control-change"
export type MidiRelativeEncoding = "one-127" | "twos-complement" | "binary-offset"
export type MidiControlInputMode =
  | { type: "note" }
  | { type: "absolute" }
  | { type: "relative"; encoding: MidiRelativeEncoding }

export interface MidiControlAddress {
  portId: string
  portName: string
  /** Zero-based MIDI channel. */
  channel: number
  type: MidiControlMessageType
  /** Note or controller number from 0 through 127. */
  number: number
}

export type MidiControlTarget =
  | { type: "application-command"; command: ApplicationCommandId }
  | {
      type: "mixer"
      channelIndex: number
      parameter: "gain" | "pan"
    }
  | {
      type: "mixer"
      channelIndex: number
      parameter: "mute" | "solo"
      behavior: "toggle" | "absolute"
    }
  | {
      type: "plugin-parameter"
      controlAlias: string
      parameterKey: string
    }

export interface MidiControlBinding {
  id: string
  address: MidiControlAddress
  input: MidiControlInputMode
  target: MidiControlTarget
  /** Required for continuous absolute/relative targets and absent for discrete targets. */
  transformProfileId?: string
}

export type MidiAbsoluteSegmentKind = "linear" | "exponential" | "logarithmic" | "s-curve" | "step"

export interface MidiAbsoluteTransformSegment {
  inputStart: number
  inputEnd: number
  outputStart: number
  outputEnd: number
  kind: MidiAbsoluteSegmentKind
  /** Curvature for exponential/logarithmic segments. */
  amount?: number
}

export interface MidiAbsoluteTransformProfile {
  id: string
  name: string
  type: "absolute"
  builtin?: boolean
  segments: MidiAbsoluteTransformSegment[]
}

export interface MidiRelativeAccelerationPoint {
  eventsPerSecond: number
  multiplier: number
}

export interface MidiRelativeTransformProfile {
  id: string
  name: string
  type: "relative"
  builtin?: boolean
  baseStep: number
  acceleration: MidiRelativeAccelerationPoint[]
}

export type MidiTransformProfile = MidiAbsoluteTransformProfile | MidiRelativeTransformProfile

export const BUILTIN_MIDI_TRANSFORM_PROFILES: readonly MidiTransformProfile[] = [
  {
    id: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear,
    name: "Linear",
    type: "absolute",
    builtin: true,
    segments: [{ inputStart: 0, inputEnd: 1, outputStart: 0, outputEnd: 1, kind: "linear" }]
  },
  {
    id: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.dawFader,
    name: "DAW fader",
    type: "absolute",
    builtin: true,
    segments: [
      { inputStart: 0, inputEnd: 0.25, outputStart: 0, outputEnd: 0.588_235, kind: "s-curve" },
      {
        inputStart: 0.25,
        inputEnd: 0.75,
        outputStart: 0.588_235,
        outputEnd: 0.882_353,
        kind: "linear"
      },
      {
        inputStart: 0.75,
        inputEnd: 1,
        outputStart: 0.882_353,
        outputEnd: 1,
        kind: "linear"
      }
    ]
  },
  {
    id: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.reverseLinear,
    name: "Reverse linear",
    type: "absolute",
    builtin: true,
    segments: [{ inputStart: 0, inputEnd: 1, outputStart: 1, outputEnd: 0, kind: "linear" }]
  },
  {
    id: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.relativeNormal,
    name: "Relative normal",
    type: "relative",
    builtin: true,
    baseStep: 1 / 127,
    acceleration: [{ eventsPerSecond: 0, multiplier: 1 }]
  },
  {
    id: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.relativeFine,
    name: "Relative fine",
    type: "relative",
    builtin: true,
    baseStep: 1 / 1024,
    acceleration: [{ eventsPerSecond: 0, multiplier: 1 }]
  }
]

export interface MidiControlPreferences {
  bindings: MidiControlBinding[]
  transformProfiles: MidiTransformProfile[]
}

export const DEFAULT_MIDI_CONTROL_PREFERENCES: Readonly<MidiControlPreferences> = {
  bindings: [],
  transformProfiles: []
}

export function midiControlAddressKey(address: MidiControlAddress): string {
  return JSON.stringify([address.portId, address.channel, address.type, address.number])
}

export function midiTransformProfile(
  preferences: MidiControlPreferences,
  profileId: string
): MidiTransformProfile | undefined {
  return (
    BUILTIN_MIDI_TRANSFORM_PROFILES.find((profile) => profile.id === profileId) ??
    preferences.transformProfiles.find((profile) => profile.id === profileId)
  )
}

export function isContinuousMidiControlTarget(target: MidiControlTarget): boolean {
  return (
    target.type === "plugin-parameter" ||
    (target.type === "mixer" && (target.parameter === "gain" || target.parameter === "pan"))
  )
}

export function midiBindingCompatibilityError(binding: MidiControlBinding): string | null {
  const continuous = isContinuousMidiControlTarget(binding.target)
  if (binding.address.type === "note") {
    if (binding.input.type !== "note") return "Note addresses require note input mode"
    if (
      binding.target.type === "application-command" ||
      (binding.target.type === "mixer" &&
        (binding.target.parameter === "mute" || binding.target.parameter === "solo") &&
        binding.target.behavior === "toggle")
    ) {
      return binding.transformProfileId
        ? "Discrete MIDI bindings cannot reference a transform profile"
        : null
    }
    return "Note input only supports application commands and toggle Mute or Solo"
  }
  if (binding.input.type === "note") return "Control-change addresses cannot use note input mode"
  if (binding.input.type === "relative" && !continuous) {
    return "Relative control-change input only supports continuous targets"
  }
  if (continuous && !binding.transformProfileId) {
    return "Continuous MIDI bindings require a transform profile"
  }
  if (!continuous && binding.transformProfileId) {
    return "Discrete MIDI bindings cannot reference a transform profile"
  }
  return null
}

export function decodeRelativeMidiValue(value: number, encoding: MidiRelativeEncoding): number {
  if (!Number.isInteger(value) || value < 0 || value > 127 || value === 0 || value === 64) return 0
  if (encoding === "one-127") {
    if (value === 1) return 1
    return value === 127 ? -1 : 0
  }
  if (encoding === "twos-complement") return value <= 63 ? value : value - 128
  return value - 64
}

export function evaluateAbsoluteMidiTransform(
  profile: MidiAbsoluteTransformProfile,
  input: number
): number {
  const value = clamp01(input)
  const segment =
    profile.segments.find(
      (candidate, index) =>
        value >= candidate.inputStart &&
        (value < candidate.inputEnd ||
          (index === profile.segments.length - 1 && value <= candidate.inputEnd))
    ) ?? profile.segments.at(-1)
  if (!segment) return value
  const width = segment.inputEnd - segment.inputStart
  const progress = width <= 0 ? 0 : clamp01((value - segment.inputStart) / width)
  const shaped = shapeAbsoluteProgress(segment, progress)
  return clamp01(segment.outputStart + (segment.outputEnd - segment.outputStart) * shaped)
}

export function evaluateRelativeMidiTransform(
  profile: MidiRelativeTransformProfile,
  delta: number,
  eventsPerSecond: number
): number {
  if (!Number.isFinite(delta) || delta === 0) return 0
  const points = [...profile.acceleration].sort(
    (left, right) => left.eventsPerSecond - right.eventsPerSecond
  )
  const rate = Math.max(0, Number.isFinite(eventsPerSecond) ? eventsPerSecond : 0)
  let multiplier = points[0]?.multiplier ?? 1
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const current = points[index]!
    if (rate > current.eventsPerSecond) {
      multiplier = current.multiplier
      continue
    }
    const width = current.eventsPerSecond - previous.eventsPerSecond
    const progress = width <= 0 ? 0 : (rate - previous.eventsPerSecond) / width
    multiplier =
      previous.multiplier + (current.multiplier - previous.multiplier) * clamp01(progress)
    break
  }
  return delta * profile.baseStep * multiplier
}

function shapeAbsoluteProgress(segment: MidiAbsoluteTransformSegment, progress: number): number {
  if (segment.kind === "linear") return progress
  if (segment.kind === "s-curve") return progress * progress * (3 - 2 * progress)
  if (segment.kind === "step") return progress < 1 ? 0 : 1
  const amount = Number.isFinite(segment.amount) ? (segment.amount as number) : 4
  if (segment.kind === "exponential") {
    if (Math.abs(amount) < Number.EPSILON) return progress
    return Math.expm1(amount * progress) / Math.expm1(amount)
  }
  const safeAmount = Math.max(-0.999_999, amount)
  if (Math.abs(safeAmount) < Number.EPSILON) return progress
  return Math.log1p(safeAmount * progress) / Math.log1p(safeAmount)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
