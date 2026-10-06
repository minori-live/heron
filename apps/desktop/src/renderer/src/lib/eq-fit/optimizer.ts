import { sectionResponse, type EqFilterType, type EqSection, type ResponseGrid } from "./biquad"

export const EQ_GAIN_LIMIT_DB = 24
export const EQ_OVERALL_GAIN_LIMIT_DB = 60
export const EQ_MIN_Q = 0.2
export const EQ_MAX_Q = 12

export interface FitContext {
  sampleRate: number
  target: readonly number[]
  grid: ResponseGrid
  minimumFrequencyHz: number
  maximumFrequencyHz: number
  iterations: number
}

export interface Candidate {
  sections: EqSection[]
  responses: number[][]
  fitted: number[]
  residual: number[]
  overallGainDb: number
  loss: number
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function evaluate(sections: EqSection[], context: FitContext): Candidate {
  const responses = sections.map((section) =>
    sectionResponse(section, context.sampleRate, context.grid)
  )
  const summed = context.target.map((_, index) =>
    responses.reduce((sum, response) => sum + response[index]!, 0)
  )
  const overallGainDb = clamp(
    mean(context.target.map((value, index) => value - summed[index]!)),
    -EQ_OVERALL_GAIN_LIMIT_DB,
    EQ_OVERALL_GAIN_LIMIT_DB
  )
  const fitted = summed.map((value) => value + overallGainDb)
  const residual = context.target.map((value, index) => value - fitted[index]!)
  return {
    sections,
    responses,
    fitted,
    residual,
    overallGainDb,
    loss: mean(residual.map((value) => value * value))
  }
}

function parameters(section: EqSection): number[] {
  return [Math.log(section.frequencyHz), section.gainDb / 12, Math.log(section.q)]
}

function fromParameters(type: EqFilterType, values: number[], context: FitContext): EqSection {
  return {
    type,
    frequencyHz: clamp(
      Math.exp(values[0]!),
      context.minimumFrequencyHz,
      context.maximumFrequencyHz
    ),
    gainDb: clamp(values[1]! * 12, -EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB),
    q: clamp(Math.exp(values[2]!), EQ_MIN_Q, EQ_MAX_Q)
  }
}

function solve(matrix: number[][], vector: number[]): number[] | undefined {
  const size = vector.length
  const rows = matrix.map((row, index) => [...row, vector[index]!])
  for (let column = 0; column < size; column++) {
    let pivot = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-12) return undefined
    ;[rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!]
    const divisor = rows[column]![column]!
    for (let item = column; item <= size; item++) rows[column]![item]! /= divisor
    for (let row = 0; row < size; row++) {
      if (row === column) continue
      const factor = rows[row]![column]!
      for (let item = column; item <= size; item++)
        rows[row]![item]! -= factor * rows[column]![item]!
    }
  }
  return rows.map((row) => row[size]!)
}

/** Bounded Levenberg-Marquardt. Frequency and Q are logarithmic parameters;
 * the independent offset is solved exactly (and bounded) at each evaluation.
 */
export function optimize(initial: Candidate, context: FitContext, limit = 55): Candidate {
  let best = initial
  let damping = 0.01
  for (let iteration = 0; iteration < limit && best.loss > 1e-8; iteration++) {
    context.iterations++
    const jacobian: number[][] = []
    for (const section of best.sections) {
      const values = parameters(section)
      for (let parameter = 0; parameter < 3; parameter++) {
        const lower = [...values]
        const upper = [...values]
        lower[parameter]! -= 0.001
        upper[parameter]! += 0.001
        const loSection = fromParameters(section.type, lower, context)
        const hiSection = fromParameters(section.type, upper, context)
        const actualStep = parameters(hiSection)[parameter]! - parameters(loSection)[parameter]!
        const lo = sectionResponse(loSection, context.sampleRate, context.grid)
        const hi = sectionResponse(hiSection, context.sampleRate, context.grid)
        const derivative = hi.map((value, index) => (value - lo[index]!) / actualStep)
        const offset =
          Math.abs(best.overallGainDb) < EQ_OVERALL_GAIN_LIMIT_DB ? mean(derivative) : 0
        jacobian.push(derivative.map((value) => value - offset))
      }
    }
    const size = jacobian.length
    const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0))
    const gradient = new Array<number>(size).fill(0)
    for (let left = 0; left < size; left++) {
      for (let sample = 0; sample < context.target.length; sample++)
        gradient[left]! += jacobian[left]![sample]! * best.residual[sample]!
      for (let right = 0; right <= left; right++) {
        let value = 0
        for (let sample = 0; sample < context.target.length; sample++)
          value += jacobian[left]![sample]! * jacobian[right]![sample]!
        matrix[left]![right] = value
        matrix[right]![left] = value
      }
      matrix[left]![left]! += damping * Math.max(1, matrix[left]![left]!)
    }
    const step = solve(matrix, gradient)
    if (!step) break
    const trial = evaluate(
      best.sections.map((section, index) =>
        fromParameters(
          section.type,
          parameters(section).map(
            (value, parameter) => value + clamp(step[3 * index + parameter]!, -0.7, 0.7)
          ),
          context
        )
      ),
      context
    )
    if (trial.loss < best.loss) {
      const improvement = best.loss - trial.loss
      best = trial
      damping = Math.max(1e-7, damping / 3)
      if (improvement < 1e-10 * Math.max(1, best.loss)) break
    } else {
      damping *= 8
      if (damping > 1e8) break
    }
  }
  return best
}

/** Search all three types, multiple locations, widths and both gain signs.
 * Keep diverse starts before joint nonlinear refinement; never claim a global optimum.
 */
export function nextCandidates(current: Candidate, context: FitContext): Candidate[] {
  const frequencies = Array.from(
    { length: 28 },
    (_, index) =>
      context.minimumFrequencyHz *
      (context.maximumFrequencyHz / context.minimumFrequencyHz) ** (index / 27)
  )
  const ranked = current.residual
    .map((value, index) => ({ index, value: Math.abs(value) }))
    .sort((left, right) => right.value - left.value)
  // Grid extrema can hide narrow peaks; include the strongest measured bins.
  for (const peak of ranked.slice(0, 8)) {
    const omega = Math.acos(context.grid.cosine[peak.index]!)
    frequencies.push(
      clamp(
        (omega * context.sampleRate) / (2 * Math.PI),
        context.minimumFrequencyHz,
        context.maximumFrequencyHz
      )
    )
  }
  const starts: Candidate[] = []
  for (const type of ["Bell", "LowShelf", "HighShelf"] as const) {
    const typed: Candidate[] = []
    for (const frequencyHz of frequencies) {
      for (const q of [0.4, Math.SQRT1_2, 1.5, 4, 8]) {
        const shape = sectionResponse(
          { type, frequencyHz, gainDb: 6, q },
          context.sampleRate,
          context.grid
        )
        const center = mean(shape)
        let dot = 0
        let norm = 0
        for (let index = 0; index < shape.length; index++) {
          const value = shape[index]! - center
          dot += value * current.residual[index]!
          norm += value * value
        }
        if (norm < 1e-8) continue
        const gainDb = clamp((6 * dot) / norm, -EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB)
        if (Math.abs(gainDb) < 0.02) continue
        typed.push(evaluate([...current.sections, { type, frequencyHz, gainDb, q }], context))
      }
    }
    typed.sort((left, right) => left.loss - right.loss)
    const diverse: Candidate[] = []
    for (const candidate of typed) {
      const section = candidate.sections.at(-1)!
      if (
        diverse.every((other) => {
          const previous = other.sections.at(-1)!
          return (
            Math.abs(Math.log(section.frequencyHz / previous.frequencyHz)) > 0.3 ||
            Math.abs(Math.log(section.q / previous.q)) > 0.6
          )
        })
      )
        diverse.push(candidate)
      if (diverse.length === 3) break
    }
    starts.push(...diverse)
  }
  return starts
}

/** Whole-model starts allow sections to move away from small-quota compromises.
 * Try shelves at either edge as well as all Bells, with two logarithmic layouts.
 */
export function modelStarts(count: number, context: FitContext): Candidate[] {
  const center = mean(context.target)
  const starts: Candidate[] = []
  for (const shift of [-0.06, 0.06]) {
    for (const lowShelf of [false, true]) {
      for (const highShelf of [false, true]) {
        const sections = Array.from({ length: count }, (_, index): EqSection => {
          const position = clamp((index + 1) / (count + 1) + shift, 0.05, 0.95)
          const frequencyHz =
            context.minimumFrequencyHz *
            (context.maximumFrequencyHz / context.minimumFrequencyHz) ** position
          const type =
            index === 0 && lowShelf
              ? "LowShelf"
              : index === count - 1 && highShelf
                ? "HighShelf"
                : "Bell"
          const sample =
            type === "LowShelf"
              ? 0
              : type === "HighShelf"
                ? context.target.length - 1
                : Math.round(position * (context.target.length - 1))
          const gain = context.target[sample]! - center
          return {
            type,
            frequencyHz,
            gainDb: clamp(Math.abs(gain) < 0.1 ? 0.1 : gain, -EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB),
            q: Math.SQRT1_2
          }
        })
        starts.push(evaluate(sections, context))
      }
    }
  }
  return starts
}
