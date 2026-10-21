import { describe, expect, it } from "vitest"
import type { TempoMapSnapshot } from "@heron/contracts"
import { zoomedViewportScrollLeft } from "./useArrangementViewport"

const tempoMap: TempoMapSnapshot = {
  ticksPerQuarter: 960,
  tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
  timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
}

describe("useArrangementViewport", () => {
  it("keeps zoom scroll positions at or beyond the timeline origin", () => {
    expect(zoomedViewportScrollLeft(tempoMap, 0.25, 120, 200)).toBe(0)
    expect(zoomedViewportScrollLeft(tempoMap, 4, 240, 100)).toBe(1_820)
  })
})
