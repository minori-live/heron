import type { TempoMapSnapshot } from "@heron/contracts"
import { timelineXToSeconds } from "./timelineCoordinates"

export function clipStartSecondsFromPointer(
  clientX: number,
  contentLeft: number,
  tempoMap: TempoMapSnapshot,
  pixelsPerQuarter: number,
  dragOffsetPixels: number
): number {
  return timelineXToSeconds(
    tempoMap,
    Math.max(0, clientX - contentLeft - dragOffsetPixels),
    pixelsPerQuarter
  )
}
