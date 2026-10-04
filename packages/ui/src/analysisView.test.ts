import { describe, expect, it } from "vitest"
import {
  fractionAtValue,
  normalizeDomain,
  panDomain,
  valueAtFraction,
  zoomDomain
} from "./analysisView"

describe("analysisView", () => {
  it("orders and separates a degenerate domain", () => {
    expect(normalizeDomain([10, 0], false)).toEqual([0, 10])
    const [low, high] = normalizeDomain([5, 5], false)
    expect(low).toBeLessThan(high)
  })

  it("zooms linearly around the anchor", () => {
    // Halving the span around 50 keeps 50 fixed.
    expect(zoomDomain([0, 100], 50, 0.5, false)).toEqual([25, 75])
  })

  it("zooms logarithmically around the anchor", () => {
    const [low, high] = zoomDomain([20, 20000], 2000, 0.5, true)
    // The anchor is preserved exactly and the span shrinks.
    expect(fractionAtValue([low, high], 2000, true)).toBeCloseTo(
      fractionAtValue([20, 20000], 2000, true),
      9
    )
    expect(high / low).toBeCloseTo(Math.sqrt(20000 / 20), 6)
  })

  it("pans by a fraction of the span and clamps to the log floor", () => {
    expect(panDomain([0, 100], 0.1, false)).toEqual([10, 110])
    const [low] = panDomain([20, 20000], -2, true)
    expect(low).toBeGreaterThanOrEqual(1e-12)
  })

  it("round-trips fraction and value", () => {
    const domain = [20, 20000] as const
    expect(valueAtFraction(domain, 0, true)).toBeCloseTo(20, 6)
    expect(valueAtFraction(domain, 1, true)).toBeCloseTo(20000, 6)
    expect(fractionAtValue(domain, valueAtFraction(domain, 0.37, true), true)).toBeCloseTo(0.37, 9)
  })
})
