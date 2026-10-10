import { describe, expect, it } from "vitest"
import expected from "../../../../../../../crates/audio-host/tests/fixtures/eq-fit/fit-preset.json"
import response from "../../../../../../../crates/audio-host/tests/fixtures/eq-fit/fit-response.json"
import { heronEqPreset } from "./preset"
import { eqMagnitudeDb, fitEq, type EqSection } from "./index"

describe("Heron EQ preset interchange", () => {
  it("exports static bands in the versioned native preset without altering fitted Q, gain or frequency", () => {
    const preset = heronEqPreset(
      [
        { type: "LowShelf", frequencyHz: 180, gainDb: 3, q: Math.SQRT1_2 },
        { type: "Bell", frequencyHz: 2400, gainDb: -5, q: 1.2 },
        { type: "HighShelf", frequencyHz: 14500, gainDb: 4, q: 0.9 }
      ],
      -2
    )
    expect(JSON.parse(preset)).toEqual(expected)
    const sections = expected.config.bands.map((band): EqSection => ({
      type: band.shape as EqSection["type"],
      frequencyHz: band.frequency_hz,
      gainDb: band.gain_db,
      q: band.q
    }))
    const db = eqMagnitudeDb(
      response.frequency_hz,
      response.sample_rate,
      sections,
      expected.config.output_gain_db
    )
    db.forEach((value, index) => expect(value).toBeCloseTo(response.magnitude_db[index]!, 8))
  })

  it("accepts the 24-band quota, stops a flat fit early and rejects a 25-band quota", () => {
    const frequencyHz = Array.from({ length: 64 }, (_, i) => 20 * 1000 ** (i / 63))
    const input = {
      sampleRate: 48000,
      frequencyHz,
      magnitudeDb: frequencyHz.map(() => -2),
      quota: 24
    }
    expect(fitEq(input)).toMatchObject({ ok: true, sections: [], overallGainDb: -2 })
    expect(fitEq({ ...input, quota: 25 })).toEqual({ ok: false, code: "invalid-input" })
  })
})
