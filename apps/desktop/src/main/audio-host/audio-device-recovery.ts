import type {
  AudioDeviceFaultKind,
  AudioDeviceList,
  AudioPreferences,
  AudioRuntimeSnapshot
} from "@heron/contracts"
import { AUDIO_BACKENDS } from "@heron/contracts"
import type { AudioHostDevice, AudioHostDeviceRecovery } from "./wire"

export type NativeAudioDeviceRecoveryPhase =
  | "waiting-for-authorization"
  | "waiting-for-change"
  | "attempting-original"
  | "original-restored"
  | "applying-selection"
  | "selection-failed"

export interface NativeAudioDeviceRecoverySnapshot {
  recoveryId: number
  revision: number
  candidateRevision: number
  attemptGeneration: number
  phase: NativeAudioDeviceRecoveryPhase
  originalPreferences: AudioPreferences
  candidates: AudioDeviceList
  lostDirections: Array<"input" | "output">
  fault: AudioDeviceFaultKind
}

export interface NativeAudioDeviceRecoveryResult {
  recovery: NativeAudioDeviceRecoverySnapshot | null
  runtime: AudioRuntimeSnapshot | null
}

const phases = new Set<NativeAudioDeviceRecoveryPhase>([
  "waiting-for-authorization",
  "waiting-for-change",
  "attempting-original",
  "original-restored",
  "applying-selection",
  "selection-failed"
])
const faults = new Set<AudioDeviceFaultKind>([
  "device-not-available",
  "stream-invalidated",
  "host-unavailable",
  "device-busy",
  "backend-error"
])

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function device(value: AudioHostDevice): AudioDeviceList["inputs"][number] | null {
  if (typeof value?.id !== "string" || typeof value.name !== "string") return null
  if (typeof value.is_default !== "boolean") return null
  return {
    id: value.id,
    name: value.name,
    isDefault: value.is_default,
    defaultSampleRate: value.default_sample_rate,
    minBufferSize: value.min_buffer_size,
    maxBufferSize: value.max_buffer_size,
    channelCount: value.channel_count
  }
}

export function decodeAudioDeviceRecovery(
  value: AudioHostDeviceRecovery | null | undefined
): NativeAudioDeviceRecoverySnapshot | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== "object") return undefined
  const config = value.original_config
  if (
    !safeInteger(value.recovery_id) ||
    !safeInteger(value.revision) ||
    !safeInteger(value.candidate_revision) ||
    !safeInteger(value.attempt_generation) ||
    !phases.has(value.phase) ||
    !faults.has(value.fault) ||
    !config ||
    !AUDIO_BACKENDS.includes(config.backend as AudioPreferences["backend"]) ||
    typeof config.input_device_id !== "string" ||
    typeof config.output_device_id !== "string" ||
    !safeInteger(config.buffer_size) ||
    !Array.isArray(value.candidates?.inputs) ||
    !Array.isArray(value.candidates.outputs) ||
    !Array.isArray(value.lost_directions) ||
    value.lost_directions.some((item) => item !== "input" && item !== "output")
  ) {
    return undefined
  }
  const inputs = value.candidates.inputs.map(device)
  const outputs = value.candidates.outputs.map(device)
  if (inputs.some((item) => item === null) || outputs.some((item) => item === null))
    return undefined
  return {
    recoveryId: value.recovery_id,
    revision: value.revision,
    candidateRevision: value.candidate_revision,
    attemptGeneration: value.attempt_generation,
    phase: value.phase,
    originalPreferences: {
      backend: config.backend as AudioPreferences["backend"],
      inputDeviceId: config.input_device_id,
      outputDeviceId: config.output_device_id,
      bufferSize: config.buffer_size
    },
    candidates: {
      inputs: inputs as AudioDeviceList["inputs"],
      outputs: outputs as AudioDeviceList["outputs"]
    },
    lostDirections: [...new Set(value.lost_directions)],
    fault: value.fault
  }
}
