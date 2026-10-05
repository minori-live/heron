import { describe, expect, it } from "vitest"
import { analysisReport } from "../../test/plugin-analysis"
import { eqFitMeasurement } from "./eqFitMeasurement"

describe("EQ measurement readiness", () => {
  it("rejects known incomplete or unstable data, without masking per-bin validity", () => {
    const report = analysisReport()
    const response = report.responses[0]!
    expect(eqFitMeasurement(report, response)).toEqual({ failure: null, warnings: [] })
    response.tail_truncated = true
    expect(eqFitMeasurement(report, response).failure).toBe("truncated-tail")
    response.tail_truncated = false
    response.repeat_error_percent = 11
    expect(eqFitMeasurement(report, response).failure).toBe("unstable-response")
    response.repeat_error_percent = Number.NaN
    expect(eqFitMeasurement(report, response).failure).toBe("invalid-measurement")
    response.repeat_error_percent = 0
    response.silence_rms = -1
    expect(eqFitMeasurement(report, response).failure).toBe("invalid-measurement")
  })

  it("warns about crosstalk, measured output noise and moderate repeat variation", () => {
    const report = analysisReport()
    const response = report.responses[2]!
    response.repeat_error_percent = 2
    response.silence_rms = 0.0001
    expect(eqFitMeasurement(report, response)).toEqual({
      failure: null,
      warnings: ["cross-channel", "repeat-variation", "noise-present"]
    })
  })
})
