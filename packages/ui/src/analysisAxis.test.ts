import { describe, expect, it } from "vitest"
import { axisDomain, formatAxisTick, linearAxisStep } from "./analysisAxis"

describe("analysis axis display resolution", () => {
  it("keeps numerical residue in a readable domain without constraining larger measurements", () => {
    const domain = axisDomain([-1e-8, 1e-8], 1, 6)
    expect(domain).toEqual([-3, 3])
    expect(linearAxisStep(domain, 6, 1)).toBe(1)
    expect(axisDomain([-90, 180], 1, 6)).toEqual([-90, 180])
    const amplitude = axisDomain([-1e-8, 2e-8], 0.01, 6)
    expect(amplitude[1] - amplitude[0]).toBeCloseTo(0.06)
    expect(linearAxisStep(amplitude, 6, 0.01)).toBeGreaterThanOrEqual(0.01)
  })

  it("bounds logarithmic frequency panning and narrow domains in physical units", () => {
    expect(axisDomain([1e-10, 1e-7], 1, 8, true)).toEqual([1, 9])
    const domain = axisDomain([1000, 1000.001], 1, 8, true)
    expect(domain[1] - domain[0]).toBeGreaterThanOrEqual(8)
    expect(domain[0]).toBeLessThan(1000)
    expect(domain[1]).toBeGreaterThan(1000.001)
  })

  it("labels grid values with units and sufficient precision instead of noise exponents", () => {
    expect(formatAxisTick(3, 1, "°")).toBe("3°")
    expect(formatAxisTick(-1e-12, 0.01, "FS")).toBe("0 FS")
    expect(formatAxisTick(0.03, 0.01, "%")).toBe("0.03%")
    expect(formatAxisTick(1001, 1, "Hz")).toBe("1.001 kHz")
    expect(formatAxisTick(1000, 1, "smp")).toBe("1000 smp")
    expect(formatAxisTick(-120, 1, "dBFS")).toBe("-120 dBFS")
    const step = linearAxisStep([1000, 1000.08], 8, 0.01)
    const labels = Array.from({ length: 9 }, (_, i) => formatAxisTick(1000 + i * step, step, "ms"))
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toContain("1000.01 ms")
  })
})
