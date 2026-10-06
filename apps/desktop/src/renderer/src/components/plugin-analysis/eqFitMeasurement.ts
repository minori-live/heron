import type { PluginAnalysisReport } from "@heron/contracts"

type Response = PluginAnalysisReport["responses"][number]
export type EqFitMeasurementWarning = "cross-channel" | "noise-present" | "repeat-variation"
export type EqFitMeasurementFailure = "invalid-measurement" | "truncated-tail" | "unstable-response"

export function eqFitMeasurement(report: PluginAnalysisReport, response: Response) {
  const warnings: EqFitMeasurementWarning[] = []
  let failure: EqFitMeasurementFailure | null = null
  if (
    !Number.isFinite(response.silence_rms) ||
    response.silence_rms < 0 ||
    !Number.isFinite(response.repeat_error_percent) ||
    response.repeat_error_percent < 0 ||
    !Number.isFinite(report.settings.level_dbfs)
  )
    failure = "invalid-measurement"
  else if (response.tail_truncated) failure = "truncated-tail"
  else if (response.repeat_error_percent > 10) failure = "unstable-response"

  if (response.input !== response.output) warnings.push("cross-channel")
  if (response.repeat_error_percent > 1) warnings.push("repeat-variation")
  // This is a conservative whole-measurement warning, never a per-bin SNR mask.
  if (20 * Math.log10(response.silence_rms) - report.settings.level_dbfs > -80) {
    warnings.push("noise-present")
  }
  return { failure, warnings }
}
