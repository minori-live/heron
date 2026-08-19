import { describe, expect, it, vi } from "vitest"
import type { TempoMapSnapshot, TransportLoopRange } from "@heron/contracts"
import type { UiGestureIntent } from "@heron/ui"
import { useCycleRangeDrag } from "./useCycleRangeDrag"

const tempoMap: TempoMapSnapshot = {
  ticksPerQuarter: 960,
  tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
  timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
}

function gesture(x: number, phase: UiGestureIntent["phase"] = "update"): UiGestureIntent {
  return {
    phase,
    point: { x, y: 0 },
    delta: { x: 0, y: 0 },
    modifiers: { alt: false, control: false, meta: false, shift: false }
  }
}

describe("useCycleRangeDrag", () => {
  it("creates a beat-snapped cycle range from an empty lane drag", () => {
    const commit = vi.fn()
    const drag = useCycleRangeDrag({
      range: () => null,
      tempoMap: () => tempoMap,
      pixelsPerQuarter: () => 480,
      commit
    })
    drag.start(gesture(480, "start"), "create")
    drag.update(gesture(1_440))
    expect(drag.preview.value).toEqual({ startTick: 960, endTick: 2_880 })
    drag.finish()

    expect(commit).toHaveBeenCalledWith({ startTick: 960, endTick: 2_880 })
    expect(drag.active.value).toBe(false)
  })

  it("moves and resizes an existing range before committing", () => {
    const range: TransportLoopRange = { startTick: 960, endTick: 2_880 }
    const commit = vi.fn()
    const drag = useCycleRangeDrag({
      range: () => range,
      tempoMap: () => tempoMap,
      pixelsPerQuarter: () => 480,
      commit
    })
    drag.start(gesture(480, "start"), "move")
    drag.update(gesture(960))
    expect(drag.preview.value).toEqual({ startTick: 1_920, endTick: 3_840 })
    drag.finish()
    expect(commit).toHaveBeenCalledWith({ startTick: 1_920, endTick: 3_840 })

    drag.start(gesture(480, "start"), "resize-end")
    drag.update(gesture(1_920))
    expect(drag.preview.value).toEqual({ startTick: 960, endTick: 3_840 })
    drag.cancel()
    expect(drag.preview.value).toBeNull()
    expect(drag.active.value).toBe(false)
  })

  it("cancels a normalized gesture without committing", () => {
    const drag = useCycleRangeDrag({
      range: () => null,
      tempoMap: () => tempoMap,
      pixelsPerQuarter: () => 480,
      commit: vi.fn()
    })
    drag.start(gesture(100, "start"), "create")
    drag.cancel()
    expect(drag.active.value).toBe(false)
    expect(drag.preview.value).toBeNull()
  })
})
