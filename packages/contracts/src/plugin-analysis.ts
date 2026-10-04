import type { PluginAnalysisReport } from "./generated/PluginAnalysisReport.ts"
import type { PluginAnalysisSettings } from "./generated/PluginAnalysisSettings.ts"
import type { PluginAnalysisFailure } from "./generated/PluginAnalysisFailure.ts"
import type {
  PluginInstanceState,
  PluginRuntimeStatus,
  PluginDescriptor,
  PluginAudioMode
} from "./plugins.ts"
import type { ResourceRef, RpcRequestMeta, RpcResult } from "./rpc.ts"
import type { AppLocale } from "./project.ts"

export type { PluginAnalysisReport, PluginAnalysisSettings }
export const DEFAULT_PLUGIN_ANALYSIS_SETTINGS: PluginAnalysisSettings = {
  sample_rate: 48_000,
  block_size: 256,
  level_dbfs: -18,
  start_hz: 20,
  end_hz: 20_000,
  sweep_seconds: 1,
  tail_seconds: 0.25
}

export function validPluginAnalysisSettings(value: unknown): value is PluginAnalysisSettings {
  if (!value || typeof value !== "object") return false
  const s = value as PluginAnalysisSettings
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

export type PluginAnalysisCommand =
  | { type: "insert"; pluginKey: string; audioMode: PluginAudioMode; slotOrder: number }
  | { type: "remove"; instanceId: string }
  | { type: "move"; instanceId: string; slotOrder: number }
  | { type: "toggle"; instanceId: string; enabled: boolean }
  | { type: "editor"; instanceId: string }
  | { type: "configure"; settings: PluginAnalysisSettings }
  | { type: "automatic"; enabled: boolean }
  | { type: "analyze" }
  | { type: "refresh-catalog" }
  | { type: "cancel" }
  | { type: "window"; action: "minimize" | "maximize" | "close" }

export interface PluginAnalysisSnapshot {
  ref: ResourceRef<"plugin-analysis">
  revision: number
  plugins: PluginInstanceState[]
  runtime: Record<string, PluginRuntimeStatus>
  catalog: PluginDescriptor[]
  settings: PluginAnalysisSettings
  automatic: boolean
  status: "idle" | "debouncing" | "running" | "complete" | "cancelled" | "failed" | "quarantined"
  phase: string
  progress: number
  report: PluginAnalysisReport | null
  reportId: string | null
  reportRevision: number | null
  memory: {
    baselineBytes: number
    loadedBytes: number
    peakBytes: number
    releasedBytes: number
  } | null
  failure:
    | PluginAnalysisFailure
    | "prepare-failed"
    | "cleanup-failed"
    | "state-changed"
    | "catalog-unavailable"
    | null
  locale: AppLocale
  theme: "light" | "dark"
}

export interface HeronPluginAnalysisApi {
  readonly platform: "darwin" | "win32" | "linux"
  /**
   * `knownReportId` lets polling omit the heavy report body while the completed
   * run is unchanged. An omitted report arrives as `report: null` with the same
   * `reportId`; callers retain their previous report in that case.
   */
  snapshot(
    meta: RpcRequestMeta,
    acknowledge?: string,
    knownReportId?: string
  ): Promise<RpcResult<PluginAnalysisSnapshot>>
  command(
    meta: RpcRequestMeta,
    command: PluginAnalysisCommand
  ): Promise<RpcResult<PluginAnalysisSnapshot>>
}
