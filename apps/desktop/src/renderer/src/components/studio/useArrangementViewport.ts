import { computed, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue"
import type { UiViewportState, UiWheelIntent } from "@heron/ui"
import type { TempoMapSnapshot } from "@heron/contracts"
import { secondsToTimelineX, timelineXToSeconds } from "../../utils/timelineCoordinates"

interface ArrangementViewportOptions {
  tempoMap: () => TempoMapSnapshot
  pixelsPerQuarter: Ref<number>
  visibleDuration: MaybeRefOrGetter<number>
  zoomTime: (direction: -1 | 1) => void
  zoomTrack: (direction: -1 | 1) => void
  zoomAmplitude: (direction: -1 | 1) => void
}

export function clampTimelineViewportX(
  clientX: number,
  viewportLeft: number,
  railWidth: number,
  viewportWidth: number
): number {
  return Math.max(0, Math.min(viewportWidth, clientX - viewportLeft - railWidth))
}

export function zoomedViewportScrollLeft(
  tempoMap: TempoMapSnapshot,
  anchorSeconds: number,
  pixelsPerQuarter: number,
  viewportX: number
): number {
  return Math.max(0, secondsToTimelineX(tempoMap, anchorSeconds, pixelsPerQuarter) - viewportX)
}

export function useArrangementViewport(options: ArrangementViewportOptions) {
  const viewportWidth = shallowRef(1)
  const scrollLeft = shallowRef(0)
  let timeZoomAnchor: { seconds: number; viewportX: number } | null = null

  const contentWidth = computed(() =>
    Math.max(
      viewportWidth.value,
      secondsToTimelineX(
        options.tempoMap(),
        toValue(options.visibleDuration),
        options.pixelsPerQuarter.value
      )
    )
  )
  const viewportStartSeconds = computed(() =>
    timelineXToSeconds(options.tempoMap(), scrollLeft.value, options.pixelsPerQuarter.value)
  )
  const viewportEndSeconds = computed(() =>
    timelineXToSeconds(
      options.tempoMap(),
      scrollLeft.value + viewportWidth.value,
      options.pixelsPerQuarter.value
    )
  )

  function handleViewport(state: UiViewportState): void {
    viewportWidth.value = state.width
    scrollLeft.value = state.scrollLeft
  }

  function handleWheel(event: UiWheelIntent): void {
    if ((event.modifiers.control || event.modifiers.meta) && event.modifiers.alt) {
      options.zoomAmplitude(event.delta.y < 0 ? 1 : -1)
    } else if (event.modifiers.control || event.modifiers.meta) {
      const viewportX = Math.max(0, Math.min(viewportWidth.value, event.point.x - scrollLeft.value))
      timeZoomAnchor = {
        seconds: timelineXToSeconds(
          options.tempoMap(),
          scrollLeft.value + viewportX,
          options.pixelsPerQuarter.value
        ),
        viewportX
      }
      options.zoomTime(event.delta.y < 0 ? 1 : -1)
    } else if (event.modifiers.alt) {
      options.zoomTrack(event.delta.y < 0 ? 1 : -1)
    } else if (event.modifiers.shift) {
      scrollLeft.value += event.delta.y
    } else {
      return
    }
  }

  watch(options.pixelsPerQuarter, (value, previous) => {
    if (!previous) return
    const width = viewportWidth.value
    const anchor = timeZoomAnchor ?? {
      seconds: timelineXToSeconds(options.tempoMap(), scrollLeft.value + width / 2, previous),
      viewportX: width / 2
    }
    timeZoomAnchor = null
    scrollLeft.value = zoomedViewportScrollLeft(
      options.tempoMap(),
      anchor.seconds,
      value,
      anchor.viewportX
    )
  })

  return {
    scrollLeft,
    contentWidth,
    viewportStartSeconds,
    viewportEndSeconds,
    handleViewport,
    handleWheel
  }
}
