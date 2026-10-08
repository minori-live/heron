import { responseGrid, type EqSection } from "./biquad"
import {
  clamp,
  evaluate,
  mean,
  modelStarts,
  nextCandidates,
  optimize,
  EQ_GAIN_LIMIT_DB,
  EQ_MAX_Q,
  EQ_MIN_Q,
  EQ_OVERALL_GAIN_LIMIT_DB,
  type Candidate,
  type FitContext
} from "./optimizer"

export { eqMagnitudeDb, type EqSection, type EqFilterType } from "./biquad"
export const EQ_FIT_DEFAULT_QUOTA = 3
export const EQ_FIT_MAX_QUOTA = 24

export interface EqFitInput {
  sampleRate: number
  frequencyHz: number[]
  magnitudeDb: number[]
  quota?: number
}

export type EqFitWarningCode =
  | "low-level"
  | "limited-range"
  | "rough-response"
  | "poor-fit"
  | "parameter-bound"
  | "narrow-feature"

export type EqFitFailureCode = "invalid-input" | "no-signal" | "unreliable-data"

export type EqFitResult =
  | {
      ok: true
      sections: EqSection[]
      overallGainDb: number
      fittedDb: number[]
      residualDb: number[]
      rmsErrorDb: number
      maxErrorDb: number
      baselineRmsErrorDb: number
      baselineMaxErrorDb: number
      elapsedMs: number
      iterations: number
      warnings: EqFitWarningCode[]
    }
  | { ok: false; code: EqFitFailureCode }

function validate(input: EqFitInput): EqFitFailureCode | undefined {
  const { frequencyHz, magnitudeDb, sampleRate } = input
  const quota = input.quota ?? EQ_FIT_DEFAULT_QUOTA
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 384000 ||
    !Number.isInteger(quota) ||
    quota < 1 ||
    quota > EQ_FIT_MAX_QUOTA ||
    frequencyHz.length !== magnitudeDb.length ||
    frequencyHz.length < 64 ||
    frequencyHz.length > 4096
  )
    return "invalid-input"
  if (
    frequencyHz.some(
      (value, index) =>
        !Number.isFinite(value) ||
        value <= 0 ||
        value >= sampleRate / 2 ||
        (index > 0 && value <= frequencyHz[index - 1]!)
    ) ||
    magnitudeDb.some((value) => !Number.isFinite(value))
  )
    return "invalid-input"
  if (frequencyHz.at(-1)! / frequencyHz[0]! < 4) return "unreliable-data"
  // A finite -240 dB floor is not evidence of a measurable transfer function.
  // Below -100 dB native analysis withholds phase; there is no per-bin confidence.
  if (Math.max(...magnitudeDb) < -80) return "no-signal"
  if (magnitudeDb.some((value) => value <= -100 || value > 80)) return "unreliable-data"
  return undefined
}

function errorMetrics(values: readonly number[]): { rms: number; max: number } {
  return {
    rms: Math.sqrt(mean(values.map((value) => value * value))),
    max: Math.max(...values.map(Math.abs))
  }
}

/** Fit measured magnitude, never inverse correction. Every original bin has
 * equal weight in dB: native reports use a logarithmic frequency grid. No display
 * smoothing, resampling, inferred confidence, or synthetic measurements enter.
 * Run only in the fitting worker; terminating that worker cancels bounded work.
 */
export function fitEq(input: EqFitInput): EqFitResult {
  const started = performance.now()
  const failure = validate(input)
  if (failure) return { ok: false, code: failure }
  const { frequencyHz, magnitudeDb, sampleRate } = input
  const minimumFrequencyHz = Math.max(10, frequencyHz[0]!)
  const maximumFrequencyHz = Math.min(24000, sampleRate * 0.475, frequencyHz.at(-1)!)
  if (minimumFrequencyHz >= maximumFrequencyHz) return { ok: false, code: "unreliable-data" }
  const context: FitContext = {
    sampleRate,
    target: magnitudeDb,
    grid: responseGrid(frequencyHz, sampleRate),
    minimumFrequencyHz,
    maximumFrequencyHz,
    iterations: 0
  }
  const warnings: EqFitWarningCode[] = []
  if (Math.max(...magnitudeDb) < -40) warnings.push("low-level")
  if (frequencyHz[0]! > 30 || frequencyHz.at(-1)! < Math.min(18000, sampleRate * 0.4))
    warnings.push("limited-range")
  const roughness = magnitudeDb
    .slice(1, -1)
    .map((value, index) => Math.abs(value - (magnitudeDb[index]! + magnitudeDb[index + 2]!) / 2))
    .sort((left, right) => left - right)
  if (roughness[Math.floor(roughness.length / 2)]! > 1)
    return { ok: false, code: "unreliable-data" }
  if (roughness[Math.floor(roughness.length * 0.8)]! > 0.5) warnings.push("rough-response")
  let best = evaluate([], context)
  const baseline = errorMetrics(best.residual)
  let beam = [best]
  for (let band = 0; band < (input.quota ?? EQ_FIT_DEFAULT_QUOTA); band++) {
    if (best.loss < 0.0001) break
    const alternatives: Candidate[] = []
    for (const previous of beam) {
      for (const candidate of nextCandidates(previous, context)) {
        const fitted = optimize(candidate, context)
        if (Number.isFinite(fitted.loss)) alternatives.push(fitted)
      }
    }
    if (band > 0) {
      for (const initial of modelStarts(band + 1, context)) {
        const fitted = optimize(initial, context)
        if (Number.isFinite(fitted.loss)) alternatives.push(fitted)
      }
    }
    alternatives.sort((left, right) => left.loss - right.loss)
    const next = alternatives[0]
    if (!next) break
    // Avoid spending quota on negligible changes or overfitting tiny roundoff.
    if (best.loss - next.loss < Math.max(0.000025, best.loss * 0.0001)) break
    best = next
    // Preserve up to three distinct Bell/shelf counts: the best small-quota
    // type combination need not extend to the best larger-quota combination.
    // LowShelf/HighShelf can be equivalent after changing independent gain.
    const counts = new Set<number>()
    beam = []
    for (const alternative of alternatives) {
      const count = alternative.sections.filter((section) => section.type === "Bell").length
      if (counts.has(count)) continue
      beam.push(alternative)
      counts.add(count)
      if (beam.length === 3) break
    }
  }
  if (
    !Number.isFinite(best.overallGainDb) ||
    !best.fitted.every(Number.isFinite) ||
    !best.residual.every(Number.isFinite) ||
    best.sections.some(
      (section) => ![section.frequencyHz, section.gainDb, section.q].every(Number.isFinite)
    )
  )
    return { ok: false, code: "unreliable-data" }
  const errors = errorMetrics(best.residual)
  if (errors.rms > 1 || errors.max > 3) warnings.push("poor-fit")
  if (best.sections.some((section) => section.q > 6)) warnings.push("narrow-feature")
  if (
    Math.abs(best.overallGainDb) >= EQ_OVERALL_GAIN_LIMIT_DB - 0.01 ||
    best.sections.some(
      (section) =>
        Math.abs(section.gainDb) >= EQ_GAIN_LIMIT_DB - 0.01 ||
        section.q <= EQ_MIN_Q * 1.01 ||
        section.q >= EQ_MAX_Q * 0.99 ||
        section.frequencyHz <= minimumFrequencyHz * 1.01 ||
        section.frequencyHz >= maximumFrequencyHz * 0.99
    )
  )
    warnings.push("parameter-bound")
  return {
    ok: true,
    sections: best.sections
      .map((section) => ({
        ...section,
        gainDb: clamp(section.gainDb, -EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB)
      }))
      .sort((left, right) => left.frequencyHz - right.frequencyHz),
    overallGainDb: best.overallGainDb,
    fittedDb: best.fitted,
    residualDb: best.residual,
    rmsErrorDb: errors.rms,
    maxErrorDb: errors.max,
    baselineRmsErrorDb: baseline.rms,
    baselineMaxErrorDb: baseline.max,
    elapsedMs: performance.now() - started,
    iterations: context.iterations,
    warnings
  }
}
