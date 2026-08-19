import { computed, shallowRef, toValue } from "vue"
import type { MaybeRefOrGetter } from "vue"
import type { TempoMapSnapshot, TransportLoopRange } from "@heron/contracts"
import type { UiGestureIntent } from "@heron/ui"
import { timelineXToTick } from "../../utils/timelineCoordinates"
import { previewCycleRange, type CycleRangeGesture } from "../../utils/cycleRange"

interface CycleRangeDragOptions {
  range: MaybeRefOrGetter<TransportLoopRange | null>
  tempoMap: MaybeRefOrGetter<TempoMapSnapshot>
  pixelsPerQuarter: MaybeRefOrGetter<number>
  commit: (range: TransportLoopRange) => void
}

interface ActiveGesture {
  mode: CycleRangeGesture
  anchorTick: number
  initialRange: TransportLoopRange | null
}

export function useCycleRangeDrag(options: CycleRangeDragOptions) {
  const gesture = shallowRef<ActiveGesture | null>(null)
  const preview = shallowRef<TransportLoopRange | null>(null)
  const active = computed(() => gesture.value !== null)

  function tickAtIntent(intent: UiGestureIntent): number {
    return timelineXToTick(
      toValue(options.tempoMap),
      Math.max(0, intent.point.x),
      toValue(options.pixelsPerQuarter)
    )
  }

  function start(intent: UiGestureIntent, mode: CycleRangeGesture): void {
    const anchorTick = tickAtIntent(intent)
    const initialRange = toValue(options.range)
    gesture.value = { mode, anchorTick, initialRange }
    preview.value = previewCycleRange(
      toValue(options.tempoMap),
      initialRange,
      mode,
      anchorTick,
      anchorTick
    )
  }

  function update(intent: UiGestureIntent): void {
    const current = gesture.value
    if (!current) return
    preview.value = previewCycleRange(
      toValue(options.tempoMap),
      current.initialRange,
      current.mode,
      current.anchorTick,
      tickAtIntent(intent)
    )
  }

  function finish(): void {
    if (!gesture.value) return
    const value = preview.value
    gesture.value = null
    preview.value = null
    if (value) options.commit(value)
  }

  function cancel(): void {
    gesture.value = null
    preview.value = null
  }

  return { active, preview, start, update, finish, cancel }
}
