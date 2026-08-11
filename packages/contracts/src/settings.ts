import type { AppLocale, RecentProject, RecordingBitDepth, ThemePreference } from "./project"
import type { MidiSyncPreferences } from "./midi"
import type { MidiControlPreferences } from "./midi-control"
import type { ShortcutPreferences } from "./shortcuts"
import type { ApplicationSettingsRef } from "./rpc"

export type MeterPeakHold = "800ms" | "2s" | "4s" | "infinite"
export const METER_RETURN_RATES = [
  "very-slow",
  "ebu-slow",
  "iec-type-ii",
  "iec-type-i",
  "fast",
  "faster",
  "very-fast"
] as const
export type MeterReturnRate = (typeof METER_RETURN_RATES)[number]
export const METER_RETURN_RATE_DB_PER_SECOND: Readonly<Record<MeterReturnRate, number>> = {
  "very-slow": 4,
  "ebu-slow": 6.3,
  "iec-type-ii": 8.6,
  "iec-type-i": 11.8,
  fast: 20,
  faster: 30,
  "very-fast": 50
}
export const DEFAULT_METER_RETURN_RATE: MeterReturnRate = "iec-type-i"

export function isMeterReturnRate(value: unknown): value is MeterReturnRate {
  return typeof value === "string" && (METER_RETURN_RATES as readonly string[]).includes(value)
}

export type MidiCenterCStandard = "yamaha-c3" | "roland-c4"
export type AudioHostThreadSetting = "auto" | number
export type PluginEditorMode = "native" | "parameters"

export const TUTORIAL_IDS = ["studio-basics"] as const
export type TutorialId = (typeof TUTORIAL_IDS)[number]

export interface TutorialPreferences {
  autoStart: boolean
  completedVersions: Partial<Record<TutorialId, number>>
}

export interface PluginEditorPreference {
  mode: PluginEditorMode
  zoomPercent: number
}

export interface AudioHostRuntimePreferences {
  workerThreads: AudioHostThreadSetting
  maxBlockingThreads: AudioHostThreadSetting
}

export interface ResolvedAudioHostRuntimePreferences {
  workerThreads: number
  maxBlockingThreads: number
}

export interface ApplicationSettings {
  swapDirectory: string
  recordingBitDepth: RecordingBitDepth
  theme: ThemePreference
  locale: AppLocale
  meterPeakHold: MeterPeakHold
  meterReturnRate: MeterReturnRate
  midiCenterCStandard: MidiCenterCStandard
  softwareMonitoringEnabled: boolean
  lowLatencyPluginBudgetMs?: number
  midiSync: MidiSyncPreferences
  midiControl: MidiControlPreferences
  audioHostRuntime: AudioHostRuntimePreferences
  pluginEditors: Record<string, PluginEditorPreference>
  shortcuts: ShortcutPreferences
  tutorials: TutorialPreferences
  recentProjects: RecentProject[]
}
export interface ApplicationSettingsResourceSnapshot {
  settings: ApplicationSettingsRef
  revision: number
  value: ApplicationSettings
}

export type ApplicationSettingsPatch = Partial<
  Pick<
    ApplicationSettings,
    | "swapDirectory"
    | "recordingBitDepth"
    | "theme"
    | "locale"
    | "meterPeakHold"
    | "meterReturnRate"
    | "midiCenterCStandard"
    | "lowLatencyPluginBudgetMs"
    | "tutorials"
  >
>
