import { computed, shallowRef, toValue, type MaybeRefOrGetter } from "vue"
import type { TempoMapSnapshot } from "@heron/contracts"
import type { UiGestureIntent } from "@heron/ui"
import { timelineXToTick } from "../../utils/timelineCoordinates"
import { barLengthTicksAtTick, barTicksThroughTick } from "../../utils/tempoMap"

interface ProjectEndDragOptions {
  endTick: MaybeRefOrGetter<number>
  tempoMap: MaybeRefOrGetter<TempoMapSnapshot>
  pixelsPerQuarter: MaybeRefOrGetter<number>
  commit: (endTick: number) => void
}

export function snapProjectEndTick(map: TempoMapSnapshot, requestedTick: number): number {
  const requested = Math.max(1, Math.round(requestedTick))
  const searchEnd = requested + barLengthTicksAtTick(map, requested)
  const boundaries = barTicksThroughTick(map, searchEnd).filter((tick) => tick > 0)
  return boundaries.reduce(
    (nearest, tick) =>
      Math.abs(tick - requested) < Math.abs(nearest - requested) ? tick : nearest,
    boundaries[0] ?? barLengthTicksAtTick(map, 0)
  )
}

export function useProjectEndDrag(options: ProjectEndDragOptions) {
  const gesture = shallowRef(false)
  const preview = shallowRef<number | null>(null)
  const active = computed(() => gesture.value)

  function tickAtIntent(intent: UiGestureIntent): number {
    return snapProjectEndTick(
      toValue(options.tempoMap),
      timelineXToTick(
        toValue(options.tempoMap),
        Math.max(0, intent.point.x),
        toValue(options.pixelsPerQuarter)
      )
    )
  }

  function start(intent: UiGestureIntent): void {
    gesture.value = true
    preview.value = tickAtIntent(intent)
  }

  function update(intent: UiGestureIntent): void {
    if (!gesture.value) return
    preview.value = tickAtIntent(intent)
  }

  function finish(): void {
    if (!gesture.value) return
    const value = preview.value
    gesture.value = false
    preview.value = null
    if (value !== null && value !== toValue(options.endTick)) options.commit(value)
  }

  function cancel(): void {
    gesture.value = false
    preview.value = null
  }

  return { active, preview, start, update, finish, cancel }
}
