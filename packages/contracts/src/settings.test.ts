import { describe, expect, it } from "vitest"
import {
  DEFAULT_METER_RETURN_RATE,
  isMeterReturnRate,
  METER_RETURN_RATE_DB_PER_SECOND,
  METER_RETURN_RATES
} from "./settings"

describe("meter return rates", () => {
  it("keeps every option ordered from slowest to fastest", () => {
    expect(METER_RETURN_RATES.map((rate) => METER_RETURN_RATE_DB_PER_SECOND[rate])).toEqual([
      4, 6.3, 8.6, 11.8, 20, 30, 50
    ])
  })

  it("defaults to IEC Type I", () => {
    expect(DEFAULT_METER_RETURN_RATE).toBe("iec-type-i")
    expect(METER_RETURN_RATE_DB_PER_SECOND[DEFAULT_METER_RETURN_RATE]).toBe(11.8)
  })

  it("recognizes only supported return-rate identifiers", () => {
    for (const rate of METER_RETURN_RATES) expect(isMeterReturnRate(rate)).toBe(true)
    for (const value of ["instant", "IEC Type I", 11.8, null]) {
      expect(isMeterReturnRate(value)).toBe(false)
    }
  })
})
