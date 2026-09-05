import { describe, expect, it, vi } from "vitest"
import type { MidiClipState } from "@heron/contracts"
import type { UiGestureIntent, UiGesturePhase } from "@heron/ui"
import { useMidiClipTrim } from "./useMidiClipTrim"

const clip: MidiClipState = {
  id: "clip-1",
  sourceId: "source-1",
  trackId: "track-1",
  name: "Verse",
  startTick: 960,
  sourceOffsetTicks: 0,
  lengthTicks: 960,
  sourceLengthTicks: 1_920,
  notes: [],
  events: []
}
const intent = (phase: UiGesturePhase, x: number): UiGestureIntent => ({
  phase,
  point: { x, y: 0 },
  delta: { x, y: 0 },
  modifiers: { alt: false, control: false, meta: false, shift: false }
})

describe("useMidiClipTrim", () => {
  it("converts normalized deltas with the project ticks-per-quarter", () => {
    const commit = vi.fn()
    const trim = useMidiClipTrim({
      clip: () => clip,
      pixelsPerQuarter: () => 480,
      ticksPerQuarter: () => 1_920,
      snap: () => "off",
      commit
    })
    trim.gesture("end", intent("start", 0))
    trim.gesture("end", intent("update", 120))
    expect(trim.preview.value).toMatchObject({ startTick: 960, lengthTicks: 1_440 })
    trim.gesture("end", intent("commit", 120))
    expect(commit).toHaveBeenCalledWith("end", 2_400)
  })

  it("cancels an in-flight preview", () => {
    const commit = vi.fn()
    const trim = useMidiClipTrim({
      clip: () => clip,
      pixelsPerQuarter: () => 480,
      ticksPerQuarter: () => 960,
      snap: () => "1/16",
      commit
    })
    trim.gesture("start", intent("start", 0))
    trim.gesture("start", intent("update", 120))
    trim.gesture("start", intent("cancel", 120))
    expect(commit).not.toHaveBeenCalled()
    expect(trim.active.value).toBeNull()
  })
})
