import type { DoctorReport } from "./generated/DoctorReport.ts"
import type { DoctorSettings } from "./generated/DoctorSettings.ts"
import type { DoctorFailure } from "./generated/DoctorFailure.ts"
import type {
  PluginInstanceState,
  PluginRuntimeStatus,
  PluginDescriptor,
  PluginAudioMode
} from "./plugins.ts"
import type { ResourceRef, RpcRequestMeta, RpcResult } from "./rpc.ts"
import type { AppLocale } from "./project.ts"

export type { DoctorReport, DoctorSettings }
export const DEFAULT_DOCTOR_SETTINGS: DoctorSettings = {
  sample_rate: 48_000,
  block_size: 256,
  level_dbfs: -18,
  start_hz: 20,
  end_hz: 20_000,
  sweep_seconds: 1,
  tail_seconds: 0.25
}

export function validDoctorSettings(value: unknown): value is DoctorSettings {
  if (!value || typeof value !== "object") return false
  const s = value as DoctorSettings
  return (
    [44100, 48000, 88200, 96000].includes(s.sample_rate) &&
    [64, 128, 256, 512, 1024].includes(s.block_size) &&
    Number.isFinite(s.level_dbfs) &&
    s.level_dbfs >= -60 &&
    s.level_dbfs <= 12 &&
    Number.isFinite(s.start_hz) &&
    s.start_hz >= 10 &&
    Number.isFinite(s.end_hz) &&
    s.end_hz > s.start_hz * 2 &&
    s.end_hz <= s.sample_rate * 0.45 &&
    Number.isFinite(s.sweep_seconds) &&
    s.sweep_seconds >= 1 &&
    s.sweep_seconds <= 8 &&
    Number.isFinite(s.tail_seconds) &&
    s.tail_seconds >= 0.25 &&
    s.tail_seconds <= 5
  )
}

export type DoctorCommand =
  | { type: "insert"; pluginKey: string; audioMode: PluginAudioMode; slotOrder: number }
  | { type: "remove"; instanceId: string }
  | { type: "move"; instanceId: string; slotOrder: number }
  | { type: "toggle"; instanceId: string; enabled: boolean }
  | { type: "editor"; instanceId: string }
  | { type: "configure"; settings: DoctorSettings }
  | { type: "automatic"; enabled: boolean }
  | { type: "analyze" }
  | { type: "refresh-catalog" }
  | { type: "cancel" }
  | { type: "window"; action: "minimize" | "maximize" | "close" }

export interface DoctorSnapshot {
  ref: ResourceRef<"plugin-doctor">
  revision: number
  plugins: PluginInstanceState[]
  runtime: Record<string, PluginRuntimeStatus>
  catalog: PluginDescriptor[]
  settings: DoctorSettings
  automatic: boolean
  status: "idle" | "debouncing" | "running" | "complete" | "cancelled" | "failed" | "quarantined"
  phase: string
  progress: number
  report: DoctorReport | null
  reportRevision: number | null
  memory: {
    baselineBytes: number
    loadedBytes: number
    peakBytes: number
    releasedBytes: number
  } | null
  failure:
    | DoctorFailure
    | "prepare-failed"
    | "cleanup-failed"
    | "state-changed"
    | "catalog-unavailable"
    | null
  locale: AppLocale
  theme: "light" | "dark"
}

export interface HeronDoctorApi {
  readonly platform: "darwin" | "win32" | "linux"
  snapshot(meta: RpcRequestMeta, acknowledge?: string): Promise<RpcResult<DoctorSnapshot>>
  command(meta: RpcRequestMeta, command: DoctorCommand): Promise<RpcResult<DoctorSnapshot>>
}
