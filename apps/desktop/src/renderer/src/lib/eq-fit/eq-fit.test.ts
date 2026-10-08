import { describe, expect, it } from "vitest"
import { biquadCoefficients } from "./biquad"
import { eqMagnitudeDb, fitEq, type EqFitInput, type EqFitResult, type EqSection } from "./index"

type Success = Extract<EqFitResult, { ok: true }>

function frequencies(
  sampleRate = 48000,
  first = 20,
  last = Math.min(20000, sampleRate * 0.45)
): number[] {
  return Array.from({ length: 384 }, (_, index) => first * (last / first) ** (index / 383))
}

function fixture(
  sections: EqSection[] = [],
  overallGainDb = 0,
  sampleRate = 48000,
  quota?: number
): EqFitInput {
  const frequencyHz = frequencies(sampleRate)
  return {
    sampleRate,
    frequencyHz,
    magnitudeDb: eqMagnitudeDb(frequencyHz, sampleRate, sections, overallGainDb),
    quota
  }
}

function fitted(input: EqFitInput): Success {
  const result = fitEq(input)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.code)
  expect(result.sections.length).toBeLessThanOrEqual(input.quota ?? 3)
  expect(result.fittedDb).toHaveLength(input.frequencyHz.length)
  expect(result.residualDb).toHaveLength(input.frequencyHz.length)
  expect(result.fittedDb.every(Number.isFinite)).toBe(true)
  const recomputed = eqMagnitudeDb(
    input.frequencyHz,
    input.sampleRate,
    result.sections,
    result.overallGainDb
  )
  expect(
    Math.max(...result.fittedDb.map((value, index) => Math.abs(value - recomputed[index]!)))
  ).toBeLessThan(1e-8)
  const residual = input.magnitudeDb.map((value, index) => value - result.fittedDb[index]!)
  expect(result.residualDb).toEqual(residual)
  expect(result.rmsErrorDb).toBeCloseTo(
    Math.sqrt(residual.reduce((sum, value) => sum + value * value, 0) / residual.length),
    10
  )
  expect(result.maxErrorDb).toBeCloseTo(Math.max(...residual.map(Math.abs)), 10)
  return result
}

function evidence(name: string, result: Success): void {
  process.stdout.write(
    JSON.stringify({
      fixture: name,
      baselineRmsDb: result.baselineRmsErrorDb,
      baselineMaxDb: result.baselineMaxErrorDb,
      fittedRmsDb: result.rmsErrorDb,
      fittedMaxDb: result.maxErrorDb,
      elapsedMs: result.elapsedMs,
      sections: result.sections.length
    }) + "\n"
  )
}

describe("digital EQ response", () => {
  it("uses digital Bell and shelf anchors, including shelf Q rather than slope S", () => {
    const sampleRate = 48000
    for (const type of ["Bell", "LowShelf", "HighShelf"] as const) {
      const section = { type, frequencyHz: 17000, gainDb: 8, q: 1.4 }
      const response = eqMagnitudeDb([0, section.frequencyHz, sampleRate / 2], sampleRate, [
        section
      ])
      expect(response[0]).toBeCloseTo(type === "LowShelf" ? 8 : 0, 8)
      expect(response[1]).toBeCloseTo(type === "Bell" ? 8 : 4, 8)
      expect(response[2]).toBeCloseTo(type === "HighShelf" ? 8 : 0, 8)
      const reciprocal = eqMagnitudeDb(frequencies(), sampleRate, [
        section,
        { ...section, gainDb: -8 }
      ])
      expect(Math.max(...reciprocal.map(Math.abs))).toBeLessThan(1e-7)
    }
    const resonant = eqMagnitudeDb(frequencies(), sampleRate, [
      { type: "LowShelf", frequencyHz: 500, gainDb: 8, q: 4 }
    ])
    expect(Math.max(...resonant)).toBeGreaterThan(8.5)
    expect(Math.min(...resonant)).toBeLessThan(-0.5)
  })

  it("keeps digital poles stable and responses finite at the supported parameter bounds", () => {
    for (const sampleRate of [8000, 44100, 96000, 384000]) {
      for (const type of ["Bell", "LowShelf", "HighShelf"] as const) {
        for (const frequencyHz of [10, Math.min(24000, sampleRate * 0.475)]) {
          for (const q of [0.2, 12]) {
            for (const gainDb of [-24, 24]) {
              const section = { type, frequencyHz, q, gainDb }
              const [, , , a0, a1, a2] = biquadCoefficients(section, sampleRate) as [
                number,
                number,
                number,
                number,
                number,
                number
              ]
              // Jury's second-order stability inequalities for normalized denominator.
              expect(Math.abs(a2 / a0)).toBeLessThan(1)
              expect(1 + a1 / a0 + a2 / a0).toBeGreaterThan(0)
              expect(1 - a1 / a0 + a2 / a0).toBeGreaterThan(0)
              expect(
                eqMagnitudeDb(frequencies(sampleRate, 10), sampleRate, [section]).every(
                  Number.isFinite
                )
              ).toBe(true)
            }
          }
        }
      }
    }
  })
})

describe("measured magnitude fitting", () => {
  it("fits flat gain without spending section quota or reversing its sign", () => {
    const result = fitted(fixture([], -7.5))
    expect(result.sections).toEqual([])
    expect(result.overallGainDb).toBeCloseTo(-7.5, 10)
    expect(result.rmsErrorDb).toBeLessThan(1e-10)
    expect(result.baselineRmsErrorDb).toBeCloseTo(0, 10)
    evidence("flat -7.5 dB", result)
  })

  it("recovers a known Bell with independent overall gain", () => {
    const result = fitted(
      fixture([{ type: "Bell", frequencyHz: 2100, gainDb: 8, q: 2.5 }], -3, 48000, 1)
    )
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.type).toBe("Bell")
    expect(result.sections[0]!.frequencyHz).toBeCloseTo(2100, 0)
    expect(result.sections[0]!.gainDb).toBeCloseTo(8, 2)
    expect(result.sections[0]!.q).toBeCloseTo(2.5, 2)
    expect(result.rmsErrorDb).toBeLessThan(0.01)
    evidence("Bell 2.1 kHz +8 dB Q2.5 / offset -3", result)
  })

  it.each([
    { type: "LowShelf" as const, frequencyHz: 140, gainDb: 5, q: Math.SQRT1_2 },
    { type: "HighShelf" as const, frequencyHz: 7200, gainDb: -6, q: 1.2 }
  ])("fits a known $type without assuming unique original parameters", (section) => {
    const result = fitted(fixture([section], 1.5, 48000, 1))
    expect(result.sections[0]!.type).not.toBe("Bell")
    expect(result.rmsErrorDb).toBeLessThan(0.01)
    evidence(section.type, result)
  })

  it("uses the default three-section budget and reports honest under-quota residual", () => {
    const input = fixture(
      [
        { type: "LowShelf", frequencyHz: 110, gainDb: 5, q: 0.7 },
        { type: "Bell", frequencyHz: 1500, gainDb: -7, q: 2 },
        { type: "HighShelf", frequencyHz: 8000, gainDb: 4, q: 0.8 }
      ],
      -2
    )
    const underQuota = fitted({ ...input, quota: 2 })
    const result = fitted(input)
    expect(result.sections).toHaveLength(3)
    expect(result.rmsErrorDb, JSON.stringify(result.sections)).toBeLessThan(0.03)
    expect(underQuota.rmsErrorDb).toBeGreaterThan(0.1)
    expect(result.rmsErrorDb).toBeLessThan(underQuota.rmsErrorDb / 10)
    evidence("three-band / quota 2", underQuota)
    evidence("three-band / default quota 3", result)
  }, 15000)

  it.each([44100, 48000, 96000])("fits high-frequency digital response at %i Hz", (sampleRate) => {
    const center = Math.min(18000, sampleRate * 0.37)
    const result = fitted(
      fixture([{ type: "Bell", frequencyHz: center, gainDb: -9, q: 3 }], 0, sampleRate, 1)
    )
    expect(result.rmsErrorDb).toBeLessThan(0.01)
    expect(result.sections[0]!.frequencyHz).toBeCloseTo(center, 0)
    evidence(`high-frequency / ${sampleRate} Hz`, result)
  })

  it("returns a bounded approximation with a poor-fit warning for an unrepresentable target", () => {
    const input = fixture([], 0, 48000, 2)
    input.magnitudeDb = input.frequencyHz.map(
      (frequency) => 5 * Math.sin(18 * Math.log(frequency / 20))
    )
    const result = fitted(input)
    expect(result.rmsErrorDb).toBeGreaterThan(2)
    expect(result.rmsErrorDb).toBeLessThan(result.baselineRmsErrorDb)
    expect(result.warnings).toContain("poor-fit")
    evidence("oscillating target / quota 2", result)
  }, 15000)

  it("honors gain, frequency and Q limits instead of claiming exact recovery outside them", () => {
    const result = fitted(
      fixture([{ type: "Bell", frequencyHz: 1000, gainDb: 40, q: 16 }], 0, 48000, 1)
    )
    for (const section of result.sections) {
      expect(section.gainDb).toBeGreaterThanOrEqual(-24)
      expect(section.gainDb).toBeLessThanOrEqual(24)
      expect(section.q).toBeGreaterThanOrEqual(0.2)
      expect(section.q).toBeLessThanOrEqual(12)
      expect(section.frequencyHz).toBeGreaterThanOrEqual(20)
      expect(section.frequencyHz).toBeLessThanOrEqual(20000)
    }
    expect(Math.abs(result.overallGainDb)).toBeLessThanOrEqual(60)
    expect(result.warnings).toContain("parameter-bound")
    expect(result.rmsErrorDb).toBeGreaterThan(0.1)
  })

  it("is deterministic and leaves report arrays unchanged across repeated fits", () => {
    const input = fixture([{ type: "Bell", frequencyHz: 830, gainDb: -4, q: 1.3 }], 0, 48000, 1)
    const before = structuredClone(input)
    const first = fitted(input)
    const second = fitted(input)
    expect(second.sections).toEqual(first.sections)
    expect(second.fittedDb).toEqual(first.fittedDb)
    expect(input).toEqual(before)
  })
})

describe("measurement validity policy", () => {
  it("rejects silent, floor-contaminated and highly irregular finite data", () => {
    expect(fitEq(fixture([], -240))).toEqual({ ok: false, code: "no-signal" })
    expect(fitEq(fixture([], -90))).toEqual({ ok: false, code: "no-signal" })
    const floor = fixture()
    floor.magnitudeDb[100] = -240
    expect(fitEq(floor)).toEqual({ ok: false, code: "unreliable-data" })
    const noisy = fixture()
    noisy.magnitudeDb = noisy.magnitudeDb.map((_, index) => (index % 2 ? -5 : 5))
    expect(fitEq(noisy)).toEqual({ ok: false, code: "unreliable-data" })
  })

  it("rejects malformed coordinates, values, budgets and unsupported sample rates", () => {
    const valid = fixture()
    const invalid: EqFitInput[] = [
      { ...valid, sampleRate: 0 },
      { ...valid, sampleRate: Infinity },
      { ...valid, quota: 0 },
      { ...valid, quota: 25 },
      { ...valid, quota: 1.5 },
      { ...valid, frequencyHz: valid.frequencyHz.slice(1) },
      {
        ...valid,
        magnitudeDb: valid.magnitudeDb.map((value, index) => (index === 2 ? NaN : value))
      },
      {
        ...valid,
        frequencyHz: valid.frequencyHz.map((value, index) => (index === 2 ? Infinity : value))
      },
      {
        ...valid,
        frequencyHz: valid.frequencyHz.map((value, index) => (index === 2 ? 20 : value))
      },
      {
        ...valid,
        frequencyHz: valid.frequencyHz.map((value, index) => (index === 383 ? 24000 : value))
      },
      { ...valid, frequencyHz: [], magnitudeDb: [] }
    ]
    for (const input of invalid) expect(fitEq(input)).toEqual({ ok: false, code: "invalid-input" })
  })

  it("warns for weak and limited-range data but rejects insufficient bandwidth", () => {
    const low = fitted(fixture([], -50))
    expect(low.warnings).toContain("low-level")
    const frequencyHz = frequencies(48000, 100, 10000)
    const limited = fitted({
      sampleRate: 48000,
      frequencyHz,
      magnitudeDb: frequencyHz.map(() => 0)
    })
    expect(limited.warnings).toContain("limited-range")
    const narrow = frequencies(48000, 1000, 2000)
    expect(
      fitEq({ sampleRate: 48000, frequencyHz: narrow, magnitudeDb: narrow.map(() => 0) })
    ).toEqual({ ok: false, code: "unreliable-data" })
  })
})
