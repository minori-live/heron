import { BUILTIN_MIDI_TRANSFORM_PROFILE_IDS, type MidiTransformProfile } from "@heron/contracts"

const profileKeys: Readonly<Record<string, string>> = {
  [BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear]: "midiSettings.profiles.linear",
  [BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.dawFader]: "midiSettings.profiles.dawFader",
  [BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.reverseLinear]: "midiSettings.profiles.reverseLinear",
  [BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.relativeNormal]: "midiSettings.profiles.relativeNormal",
  [BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.relativeFine]: "midiSettings.profiles.relativeFine"
}

export function midiTransformProfileLabel(
  profile: MidiTransformProfile,
  t: (key: string) => string
): string {
  const key = profile.builtin ? profileKeys[profile.id] : undefined
  return key ? t(key) : profile.name
}
