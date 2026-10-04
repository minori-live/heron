export type AnalysisDomain = readonly [number, number]

// Below this span a zoom crosses into floating point noise; keep a floor so the
// inverse transforms never divide by zero.
const MINIMUM_SPAN = 1e-9
const LOG_FLOOR = 1e-12

function scaled(value: number, logarithmic: boolean): number {
  return logarithmic ? Math.log(Math.max(LOG_FLOOR, value)) : value
}

function unscaled(value: number, logarithmic: boolean): number {
  return logarithmic ? Math.exp(value) : value
}

/** Clamp a display domain to a finite, ordered, non-degenerate interval. */
export function normalizeDomain(
  domain: AnalysisDomain,
  logarithmic: boolean,
  minimumSpan = MINIMUM_SPAN
): AnalysisDomain {
  let [low, high] = domain
  if (!Number.isFinite(low) || !Number.isFinite(high)) return domain
  if (high < low) [low, high] = [high, low]
  const span = Math.max(MINIMUM_SPAN, minimumSpan)
  if (high - low < span) {
    const center = (low + high) / 2
    low = center - span / 2
    high = center + span / 2
  }
  if (logarithmic) {
    low = Math.max(LOG_FLOOR, low)
    high = Math.max(low + span, low * (1 + 1e-9), high)
  }
  return [low, high]
}

/**
 * Zoom around an anchor value by a multiplicative factor. `factor < 1` narrows
 * the visible interval; `factor > 1` widens it. The anchor keeps its position,
 * so a wheel zoom follows the pointer.
 */
export function zoomDomain(
  domain: AnalysisDomain,
  anchor: number,
  factor: number,
  logarithmic: boolean
): AnalysisDomain {
  const low = scaled(domain[0], logarithmic)
  const high = scaled(domain[1], logarithmic)
  const pivot = scaled(anchor, logarithmic)
  return normalizeDomain(
    [
      unscaled(pivot + (low - pivot) * factor, logarithmic),
      unscaled(pivot + (high - pivot) * factor, logarithmic)
    ],
    logarithmic
  )
}

/**
 * Shift a domain by a fraction of its visible span. A positive fraction moves
 * towards higher values so vertical wheel gestures on the frequency axis pan
 * in the direction the pointer implies.
 */
export function panDomain(
  domain: AnalysisDomain,
  fraction: number,
  logarithmic: boolean
): AnalysisDomain {
  const low = scaled(domain[0], logarithmic)
  const high = scaled(domain[1], logarithmic)
  const shift = (high - low) * fraction
  return normalizeDomain(
    [unscaled(low + shift, logarithmic), unscaled(high + shift, logarithmic)],
    logarithmic
  )
}

/** Value at a normalized position across the visible domain (0 = minimum). */
export function valueAtFraction(
  domain: AnalysisDomain,
  fraction: number,
  logarithmic: boolean
): number {
  const low = scaled(domain[0], logarithmic)
  const high = scaled(domain[1], logarithmic)
  return unscaled(low + (high - low) * fraction, logarithmic)
}

/** Normalized position of a value across the visible domain (0 = minimum). */
export function fractionAtValue(
  domain: AnalysisDomain,
  value: number,
  logarithmic: boolean
): number {
  const low = scaled(domain[0], logarithmic)
  const high = scaled(domain[1], logarithmic)
  return (scaled(value, logarithmic) - low) / (high - low || 1)
}
