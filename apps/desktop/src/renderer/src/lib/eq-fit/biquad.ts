export type EqFilterType = "Bell" | "LowShelf" | "HighShelf"

export interface EqSection {
  type: EqFilterType
  frequencyHz: number
  gainDb: number
  q: number
}

export interface ResponseGrid {
  cosine: number[]
  sine: number[]
  cosine2: number[]
  sine2: number[]
}

export function responseGrid(frequencyHz: readonly number[], sampleRate: number): ResponseGrid {
  const omega = frequencyHz.map((frequency) => (2 * Math.PI * frequency) / sampleRate)
  return {
    cosine: omega.map(Math.cos),
    sine: omega.map(Math.sin),
    cosine2: omega.map((value) => Math.cos(2 * value)),
    sine2: omega.map((value) => Math.sin(2 * value))
  }
}

/** RBJ cookbook Q convention: alpha = sin(w0)/(2Q), including both shelves.
 * Shelf Q is not shelf slope S. Q > sqrt(1/2) permits resonant overshoot.
 * https://www.w3.org/TR/audio-eq-cookbook/
 */
export function biquadCoefficients(section: EqSection, sampleRate: number): number[] {
  const a = 10 ** (section.gainDb / 40)
  const omega = (2 * Math.PI * section.frequencyHz) / sampleRate
  const cosine = Math.cos(omega)
  const alpha = Math.sin(omega) / (2 * section.q)
  if (section.type === "Bell") {
    return [1 + alpha * a, -2 * cosine, 1 - alpha * a, 1 + alpha / a, -2 * cosine, 1 - alpha / a]
  }
  const beta = 2 * Math.sqrt(a) * alpha
  const plus = a + 1
  const minus = a - 1
  if (section.type === "LowShelf") {
    return [
      a * (plus - minus * cosine + beta),
      2 * a * (minus - plus * cosine),
      a * (plus - minus * cosine - beta),
      plus + minus * cosine + beta,
      -2 * (minus + plus * cosine),
      plus + minus * cosine - beta
    ]
  }
  return [
    a * (plus + minus * cosine + beta),
    -2 * a * (minus + plus * cosine),
    a * (plus + minus * cosine - beta),
    plus - minus * cosine + beta,
    2 * (minus - plus * cosine),
    plus - minus * cosine - beta
  ]
}

export function sectionResponse(
  section: EqSection,
  sampleRate: number,
  grid: ResponseGrid
): number[] {
  const [b0, b1, b2, a0, a1, a2] = biquadCoefficients(section, sampleRate) as [
    number,
    number,
    number,
    number,
    number,
    number
  ]
  return grid.cosine.map((cosine, index) => {
    // Complex evaluation avoids cancellation of squared coefficient polynomials
    // for low cutoff frequencies at high sample rates.
    const realB = b0 + b1 * cosine + b2 * grid.cosine2[index]!
    const imaginaryB = b1 * grid.sine[index]! + b2 * grid.sine2[index]!
    const realA = a0 + a1 * cosine + a2 * grid.cosine2[index]!
    const imaginaryA = a1 * grid.sine[index]! + a2 * grid.sine2[index]!
    return (
      10 *
      Math.log10(
        (realB * realB + imaginaryB * imaginaryB) / (realA * realA + imaginaryA * imaginaryA)
      )
    )
  })
}

export function eqMagnitudeDb(
  frequencyHz: readonly number[],
  sampleRate: number,
  sections: readonly EqSection[],
  overallGainDb = 0
): number[] {
  const grid = responseGrid(frequencyHz, sampleRate)
  const result = frequencyHz.map(() => overallGainDb)
  for (const section of sections) {
    const response = sectionResponse(section, sampleRate, grid)
    for (let index = 0; index < result.length; index++) result[index]! += response[index]!
  }
  return result
}
