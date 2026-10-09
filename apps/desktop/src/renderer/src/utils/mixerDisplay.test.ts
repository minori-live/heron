import { describe, expect, it } from "vitest"
import {
  dbToLevelPercent,
  FADER_MAX_DB,
  FADER_MIN_DB,
  FADER_SCALE_MARKS,
  METER_MAX_DB,
  METER_MIN_DB,
  METER_SCALE_MARKS
} from "./mixerDbScale"
import { normalizedToPanUnits, panLabelFromNormalized, panUnitsToNormalized } from "./mixerPan"

describe("mixer dB scales", () => {
  it("maps levels into a clamped bottom-up percentage", () => {
    expect(dbToLevelPercent(0, METER_MIN_DB, METER_MAX_DB)).toBe(100)
    expect(dbToLevelPercent(-30, METER_MIN_DB, METER_MAX_DB)).toBe(50)
    expect(dbToLevelPercent(-90, METER_MIN_DB, METER_MAX_DB)).toBe(0)
    expect(dbToLevelPercent(24, FADER_MIN_DB, FADER_MAX_DB)).toBe(100)
    expect(dbToLevelPercent(Number.NEGATIVE_INFINITY, FADER_MIN_DB, FADER_MAX_DB)).toBe(0)
  })

  it("keeps scale marks aligned with the same conversion used by the controls", () => {
    for (const mark of FADER_SCALE_MARKS) {
      expect(mark.position).toBeCloseTo(
        100 - dbToLevelPercent(mark.value, FADER_MIN_DB, FADER_MAX_DB)
      )
    }
    for (const mark of METER_SCALE_MARKS) {
      expect(mark.position).toBeCloseTo(
        100 - dbToLevelPercent(mark.value, METER_MIN_DB, METER_MAX_DB)
      )
    }
  })
})

describe("mixerPan", () => {
  it("converts normalized pan to discrete units with asymmetric left/right ranges", () => {
    expect(normalizedToPanUnits(0)).toBe(0)
    expect(normalizedToPanUnits(-1)).toBe(-64)
    expect(normalizedToPanUnits(1)).toBe(63)
    expect(normalizedToPanUnits(-0.5)).toBe(-32)
    expect(normalizedToPanUnits(0.5)).toBe(32)
    expect(normalizedToPanUnits(2)).toBe(63)
    expect(normalizedToPanUnits(-2)).toBe(-64)
  })

  it("round-trips pan units through normalized space", () => {
    for (const units of [-64, -32, -1, 0, 1, 32, 63]) {
      expect(normalizedToPanUnits(panUnitsToNormalized(units))).toBe(units)
    }
    expect(panUnitsToNormalized(100)).toBe(1)
    expect(panUnitsToNormalized(-100)).toBe(-1)
  })

  it("formats center, left, and right pan labels", () => {
    expect(panLabelFromNormalized(0)).toBe("C")
    expect(panLabelFromNormalized(-1)).toBe("L64")
    expect(panLabelFromNormalized(1)).toBe("R63")
    expect(panLabelFromNormalized(0.5)).toBe("R32")
  })
})
