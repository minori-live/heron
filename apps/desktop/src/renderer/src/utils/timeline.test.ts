import { describe, expect, it } from "vitest"
import type { TempoMapSnapshot } from "@heron/contracts"
import { defaultCycleRange, previewCycleRange, snapTickToBeat } from "./cycleRange"
import { clipStartSecondsFromPointer, findNearestTrackId } from "./clipDrag"
import {
  barLengthTicksAtTick,
  barTicksWithinSeconds,
  beatTicksThroughTick,
  musicalPositionAtTick,
  replaceTempoEventAtTick,
  replaceTimeSignatureEventAtTick,
  secondsToTick,
  tempoEventAtTick,
  tempoAtTick,
  tickToSeconds,
  timeSignatureAtTick
} from "./tempoMap"
import { secondsToTimelineX, timelineXToSeconds } from "./timelineCoordinates"

describe("cycle range editing", () => {
  const map: TempoMapSnapshot = {
    ticksPerQuarter: 960,
    tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
    timeSignatureEvents: [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 7_680, numerator: 6, denominator: 8 }
    ]
  }

  it("snaps to beats and creates a minimum one-beat range", () => {
    expect(snapTickToBeat(map, 1_390)).toBe(960)
    expect(previewCycleRange(map, null, "create", 1_390, 1_400)).toEqual({
      startTick: 960,
      endTick: 1_920
    })
  })

  it("resizes and moves while preserving valid bounds", () => {
    const range = { startTick: 960, endTick: 3_840 }
    expect(previewCycleRange(map, range, "resize-start", 960, 3_700)).toEqual({
      startTick: 2_880,
      endTick: 3_840
    })
    expect(previewCycleRange(map, range, "move", 960, 0)).toEqual({
      startTick: 0,
      endTick: 2_880
    })
  })

  it("creates the default region from the playhead bar", () => {
    expect(defaultCycleRange(map, 5_000)).toEqual({ startTick: 3_840, endTick: 7_680 })
    expect(defaultCycleRange(map, 8_000)).toEqual({ startTick: 7_680, endTick: 10_560 })
  })
})

describe("musical timeline coordinates", () => {
  const map = (beatsPerMinute: number): TempoMapSnapshot => ({
    ticksPerQuarter: 960,
    tempoEvents: [{ tick: 0, beatsPerMinute }],
    timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
  })

  it("preserves the existing scale at the 120 BPM reference tempo", () => {
    const pixelsPerQuarter = 50
    expect(secondsToTimelineX(map(120), 2, pixelsPerQuarter)).toBe(200)
  })

  it("makes fixed-duration audio occupy more beats at a faster tempo", () => {
    const pixelsPerQuarter = 50
    expect(secondsToTimelineX(map(60), 2, pixelsPerQuarter)).toBe(100)
    expect(secondsToTimelineX(map(120), 2, pixelsPerQuarter)).toBe(200)
    expect(secondsToTimelineX(map(180), 2, pixelsPerQuarter)).toBe(300)
  })

  it("round-trips timeline positions through stepped tempo changes", () => {
    const tempoMap: TempoMapSnapshot = {
      ticksPerQuarter: 960,
      tempoEvents: [
        { tick: 0, beatsPerMinute: 120 },
        { tick: 3_840, beatsPerMinute: 60 }
      ],
      timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
    }
    const pixelsPerQuarter = 50
    const x = secondsToTimelineX(tempoMap, 3, pixelsPerQuarter)
    expect(x).toBe(250)
    expect(timelineXToSeconds(tempoMap, x, pixelsPerQuarter)).toBe(3)
  })
})

describe("tempo map", () => {
  const map: TempoMapSnapshot = {
    ticksPerQuarter: 960,
    tempoEvents: [
      { tick: 0, beatsPerMinute: 120 },
      { tick: 3_840, beatsPerMinute: 60 }
    ],
    timeSignatureEvents: [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 3_840, numerator: 3, denominator: 4 }
    ]
  }

  it("converts musical ticks through stepped tempo changes", () => {
    expect(tickToSeconds(map, 3_840)).toBe(2)
    expect(tickToSeconds(map, 4_800)).toBe(3)
    expect(secondsToTick(map, 3)).toBe(4_800)
  })

  it("reports values and musical position at the playhead", () => {
    expect(tempoEventAtTick(map, 4_800)).toEqual({
      tick: 3_840,
      beatsPerMinute: 60
    })
    expect(tempoAtTick(map, 4_800)).toBe(60)
    expect(timeSignatureAtTick(map, 4_800)).toMatchObject({
      numerator: 3,
      denominator: 4
    })
    expect(musicalPositionAtTick(map, 4_800)).toEqual({
      bar: 2,
      beat: 2,
      tick: 0
    })
    expect(barLengthTicksAtTick(map, 0)).toBe(3_840)
    expect(barLengthTicksAtTick(map, 4_800)).toBe(2_880)
  })

  it("replaces the active event without inserting a marker at the playhead", () => {
    const replaced = replaceTempoEventAtTick(map, 4_800, 72.5)

    expect(replaced.tempoEvents).toEqual([
      { tick: 0, beatsPerMinute: 120 },
      { tick: 3_840, beatsPerMinute: 72.5 }
    ])
    expect(map.tempoEvents[1]?.beatsPerMinute).toBe(60)
  })

  it("replaces the active meter event without inserting a marker at the playhead", () => {
    const replaced = replaceTimeSignatureEventAtTick(map, 4_800, {
      numerator: 7,
      denominator: 8
    })

    expect(replaced.timeSignatureEvents).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 3_840, numerator: 7, denominator: 8 }
    ])
    expect(map.timeSignatureEvents[1]).toMatchObject({ numerator: 3, denominator: 4 })
  })

  it("places bar guides using both tempo and time-signature changes", () => {
    expect(barTicksWithinSeconds(map, 5)).toEqual([0, 3_840, 6_720])
  })

  it("places beat guides between bars and follows the active denominator", () => {
    expect(
      beatTicksThroughTick(
        {
          ...map,
          timeSignatureEvents: [
            { tick: 0, numerator: 4, denominator: 4 },
            { tick: 3_840, numerator: 6, denominator: 8 }
          ]
        },
        6_720
      )
    ).toEqual([960, 1_920, 2_880, 4_320, 4_800, 5_280, 5_760, 6_240])
  })
})

describe("clip drag snapping", () => {
  const tempoMap: TempoMapSnapshot = {
    ticksPerQuarter: 960,
    tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
    timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
  }
  const lanes = [
    { trackId: "audio-1", top: 127, bottom: 227 },
    { trackId: "audio-2", top: 227, bottom: 347 },
    { trackId: "audio-3", top: 347, bottom: 427 }
  ]

  it("keeps the clip on the lane under the pointer", () => {
    expect(findNearestTrackId(lanes, 180)).toBe("audio-1")
    expect(findNearestTrackId(lanes, 300)).toBe("audio-2")
    expect(findNearestTrackId(lanes, 400)).toBe("audio-3")
  })

  it("snaps to the nearest edge outside the track rows", () => {
    expect(findNearestTrackId(lanes, 40)).toBe("audio-1")
    expect(findNearestTrackId(lanes, 500)).toBe("audio-3")
    expect(findNearestTrackId([], 200)).toBeNull()
  })

  it("preserves the grabbed point while clamping the clip to the timeline start", () => {
    expect(clipStartSecondsFromPointer(450, 100, tempoMap, 50, 50)).toBe(3)
    expect(clipStartSecondsFromPointer(110, 100, tempoMap, 50, 50)).toBe(0)
  })

  it("maps a musical drag position through the active tempo", () => {
    const fasterMap = {
      ...tempoMap,
      tempoEvents: [{ tick: 0, beatsPerMinute: 180 }]
    }
    expect(clipStartSecondsFromPointer(450, 100, fasterMap, 50, 50)).toBe(2)
  })
})
