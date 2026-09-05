import { shallowRef } from "vue"
import { describe, expect, it, vi } from "vitest"
import type { MidiClipState, TempoMapSnapshot } from "@heron/contracts"
import type { PianoRollSnap } from "../../utils/pianoRoll"
import { useMidiClipDrag } from "./useMidiClipDrag"

const tempoMap: TempoMapSnapshot = {
  ticksPerQuarter: 960,
  tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
  timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
}

const clip: MidiClipState = {
  id: "clip-1",
  sourceId: "source-1",
  trackId: "instrument-1",
  name: "Verse",
  startTick: 0,
  lengthTicks: 960,
  sourceOffsetTicks: 0,
  sourceLengthTicks: Number.MAX_SAFE_INTEGER,
  notes: [],
  events: []
}

describe("useMidiClipDrag", () => {
  it("previews snapped position and target track before committing once on drop", () => {
    const moveClip = vi.fn()
    const drag = useMidiClipDrag({
      clips: shallowRef([clip]),
      tempoMap: () => tempoMap,
      pixelsPerQuarter: shallowRef(120),
      snap: shallowRef<PianoRollSnap>("1/16"),
      moveClip
    })
    const event = {
      point: { x: 145, y: 150 },
      targetId: "instrument-2",
      targetKind: "instrument",
      data: []
    }

    drag.handleMidiClipDragStart("clip-1", 20)
    drag.updateMidiClipDrag(event)

    expect(drag.midiDragPreview.value).toMatchObject({
      id: "clip-1",
      trackId: "instrument-2",
      startTick: 960
    })
    expect(moveClip).not.toHaveBeenCalled()

    drag.handleMidiClipDrop(event)
    expect(moveClip).toHaveBeenCalledOnce()
    expect(moveClip).toHaveBeenCalledWith("clip-1", "instrument-2", 960)
    expect(drag.midiDragPreview.value).toBeNull()
  })
})
