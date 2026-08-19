import { computed, shallowRef, type Ref } from "vue"
import type { UiDropIntent } from "@heron/ui"
import type { TempoMapSnapshot } from "@heron/contracts"
import type { TimelineClip } from "../../stores/transport"
import { clipStartSecondsFromPointer } from "../../utils/clipDrag"

interface ArrangementClipDragOptions {
  clips: Ref<TimelineClip[]>
  tempoMap: () => TempoMapSnapshot
  pixelsPerQuarter: Ref<number>
  moveClip: (clipId: string, trackId: string, startSeconds: number) => void
}

export function useArrangementClipDrag(options: ArrangementClipDragOptions) {
  const clipDrag = shallowRef<{
    clipId: string
    offsetPixels: number
    trackId: string
    startSeconds: number
  } | null>(null)

  const dragPreview = computed<TimelineClip | null>(() => {
    const drag = clipDrag.value
    if (!drag) return null
    const clip = options.clips.value.find((candidate) => candidate.id === drag.clipId)
    if (!clip) return null
    return {
      ...clip,
      trackId: drag.trackId,
      startSeconds: drag.startSeconds,
      endSeconds: drag.startSeconds + clip.durationSeconds
    }
  })

  function handleClipDragStart(clipId: string, offsetPixels: number): void {
    const clip = options.clips.value.find((candidate) => candidate.id === clipId)
    if (!clip) return
    clipDrag.value = {
      clipId,
      offsetPixels,
      trackId: clip.trackId,
      startSeconds: clip.startSeconds
    }
  }

  function updateClipDrag(event: UiDropIntent): void {
    const drag = clipDrag.value
    if (!drag || event.targetKind !== "audio" || !event.targetId) return
    const startSeconds = clipStartSecondsFromPointer(
      event.point.x,
      0,
      options.tempoMap(),
      options.pixelsPerQuarter.value,
      drag.offsetPixels
    )
    clipDrag.value = { ...drag, trackId: event.targetId, startSeconds }
  }

  function handleClipDrop(event: UiDropIntent): void {
    if (!clipDrag.value) return
    updateClipDrag(event)
    const drag = clipDrag.value
    if (!drag) return
    options.moveClip(drag.clipId, drag.trackId, drag.startSeconds)
    clipDrag.value = null
  }

  function handleClipDragEnd(): void {
    clipDrag.value = null
  }

  return {
    clipDrag,
    dragPreview,
    handleClipDragStart,
    updateClipDrag,
    handleClipDrop,
    handleClipDragEnd
  }
}
