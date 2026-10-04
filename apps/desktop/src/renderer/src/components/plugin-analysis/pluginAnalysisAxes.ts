/** Display resolution in each measurement unit; report values are never rounded. */
export const pluginAnalysisMinimumSteps = {
  Hz: 1,
  dB: 1,
  dBc: 1,
  dBFS: 1,
  "°": 1,
  "%": 0.01,
  FS: 0.01,
  ms: 0.01,
  s: 0.001,
  μs: 0.1,
  smp: 1
} as const

export type PluginAnalysisAxisUnit = keyof typeof pluginAnalysisMinimumSteps

export function pluginAnalysisAxisLabel(label: string, unit: PluginAnalysisAxisUnit): string {
  return label === unit ? unit : `${label} (${unit})`
}
