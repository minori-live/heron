import { normalizeDomain, type AnalysisDomain } from "./analysisView"

/** Enforce the caller's display resolution for auto domains and all gestures. */
export function axisDomain(
  domain: AnalysisDomain,
  minimumStep: number,
  intervals: number,
  logarithmic = false
): AnalysisDomain {
  const normalized = normalizeDomain(domain, logarithmic, minimumStep * intervals)
  if (!logarithmic || minimumStep <= 0) return normalized
  const low = Math.max(minimumStep, normalized[0])
  return [low, Math.max(low + minimumStep * intervals, normalized[1])]
}

/** Rounded linear grid interval with a caller-owned minimum resolution. */
export function linearAxisStep(
  domain: AnalysisDomain,
  intervals: number,
  minimumStep: number
): number {
  const [low, high] = domain
  const desired = Math.max(minimumStep, (high - low) / intervals)
  const power = 10 ** Math.floor(Math.log10(desired))
  const factor = desired / power
  return Math.max(
    minimumStep,
    (factor <= 1 + 1e-10 ? 1 : factor <= 2 + 1e-10 ? 2 : factor <= 5 + 1e-10 ? 5 : 10) * power
  )
}

/** Round labels to grid precision, avoiding negative zero and noise exponents. */
export function formatAxisTick(value: number, step: number, unit: string): string {
  const kilo = Math.abs(value) >= 1000 && unit === "Hz"
  const scaledStep = kilo ? step / 1000 : step
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(scaledStep))))
  const rounded = Number((kilo ? value / 1000 : value).toFixed(decimals))
  const suffix = kilo ? "kHz" : unit
  return `${rounded}${suffix === "°" || suffix === "%" ? "" : " "}${suffix}`.trim()
}
