/** Deterministic drawing helpers for the stylized product windows. */

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/** A mirrored waveform in a 100 × 20 view box. */
export function waveformPath(seed: number, points = 72): string {
  const next = random(seed)
  const top: string[] = []
  const bottom: string[] = []
  let level = 0.5
  for (let i = 0; i <= points; i++) {
    level = Math.min(1, Math.max(0.12, level + (next() - 0.5) * 0.55))
    const x = ((i / points) * 100).toFixed(2)
    const amplitude = level * (0.55 + next() * 0.45) * 9
    top.push(`${x} ${(10 - amplitude).toFixed(2)}`)
    bottom.unshift(`${x} ${(10 + amplitude).toFixed(2)}`)
  }
  return `M${top.join(" L")} L${bottom.join(" L")} Z`
}

export interface NoteRect {
  x: number
  y: number
  w: number
}

/** MIDI note rectangles in a 100 × 12 view box. */
export function midiNotes(seed: number, count: number, drum = false): NoteRect[] {
  const next = random(seed)
  const step = 100 / count
  return Array.from({ length: count }, (_, i) => ({
    x: i * step + (drum ? 0 : next() * step * 0.2),
    y: drum ? [2, 8, 5, 8][i % 4]! : Math.floor(next() * 10),
    w: drum ? step * 0.36 : step * (0.5 + next() * 0.45)
  }))
}

export interface EqBand {
  x: number
  gain: number
  width: number
  color: string
}

/** Combined response in decibels at a normalized log-frequency position. */
export function eqResponse(bands: EqBand[], x: number): number {
  const lowCut = -30 * (1 - Math.min(1, x / 0.07)) ** 2
  return bands.reduce(
    (sum, band) => sum + band.gain * Math.exp(-(((x - band.x) / band.width) ** 2) / 2),
    lowCut
  )
}

/** An EQ curve in a 400 × 200 view box spanning ±18 dB. */
export function eqCurvePath(bands: EqBand[]): string {
  const parts: string[] = []
  for (let i = 0; i <= 120; i++) {
    const x = i / 120
    const y = 100 - (eqResponse(bands, x) / 18) * 100
    parts.push(`${(x * 400).toFixed(1)} ${Math.min(205, Math.max(-5, y)).toFixed(1)}`)
  }
  return `M${parts.join(" L")}`
}

/** A moving spectrum in a 400 × 200 view box; `closed` returns a fillable area. */
export function spectrumPath(t: number, seed: number, closed: boolean, tilt = 0): string {
  const parts: string[] = []
  for (let i = 0; i <= 80; i++) {
    const x = i / 80
    const body = 0.62 - 0.38 * x + tilt * Math.exp(-(((x - 0.3) / 0.12) ** 2))
    const shimmer =
      Math.sin(x * 37 + t * 3.1 + seed) * 0.035 +
      Math.sin(x * 91 - t * 5.3 + seed * 2) * 0.02 +
      Math.sin(t * 1.7 + x * 6) * 0.03
    const level = Math.max(0.04, (body + shimmer) * (1 - Math.max(0, x - 0.86) * 4))
    parts.push(`${(x * 400).toFixed(1)} ${(200 - level * 200).toFixed(1)}`)
  }
  return closed ? `M0 200 L${parts.join(" L")} L400 200 Z` : `M${parts.join(" L")}`
}
