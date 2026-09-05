import { computed, shallowRef, type Ref } from "vue"
import type { UiDropIntent } from "@heron/ui"
import type { MidiClipState, TempoMapSnapshot } from "@heron/contracts"
import type { PianoRollSnap } from "../../utils/pianoRoll"
import { snapTicks } from "../../utils/pianoRoll"
import { timelineXToTick } from "../../utils/timelineCoordinates"

interface MidiClipDragOptions {
  clips: Ref<MidiClipState[]>
  tempoMap: () => TempoMapSnapshot
  pixelsPerQuarter: Ref<number>
  snap: Ref<PianoRollSnap>
  moveClip: (clipId: string, trackId: string, startTick: number) => void
}

export function useMidiClipDrag(options: MidiClipDragOptions) {
  const midiClipDrag = shallowRef<{
    clipId: string
    offsetPixels: number
    trackId: string
    startTick: number
  } | null>(null)

  const midiDragPreview = computed<MidiClipState | null>(() => {
    const drag = midiClipDrag.value
    if (!drag) return null
    const clip = options.clips.value.find((candidate) => candidate.id === drag.clipId)
    return clip ? { ...clip, trackId: drag.trackId, startTick: drag.startTick } : null
  })

  function handleMidiClipDragStart(clipId: string, offsetPixels: number): void {
    const clip = options.clips.value.find((candidate) => candidate.id === clipId)
    if (!clip) return
    midiClipDrag.value = {
      clipId,
      offsetPixels,
      trackId: clip.trackId,
      startTick: clip.startTick
    }
  }

  function updateMidiClipDrag(event: UiDropIntent): void {
    const drag = midiClipDrag.value
    if (!drag || event.targetKind !== "instrument" || !event.targetId) return
    const rawTick = timelineXToTick(
      options.tempoMap(),
      Math.max(0, event.point.x - drag.offsetPixels),
      options.pixelsPerQuarter.value
    )
    midiClipDrag.value = {
      ...drag,
      trackId: event.targetId,
      startTick: snapTicks(rawTick, options.snap.value)
    }
  }

  function handleMidiClipDrop(event: UiDropIntent): void {
    if (!midiClipDrag.value) return
    updateMidiClipDrag(event)
    const drag = midiClipDrag.value
    if (!drag) return
    options.moveClip(drag.clipId, drag.trackId, drag.startTick)
    midiClipDrag.value = null
  }

  function handleMidiClipDragEnd(): void {
    midiClipDrag.value = null
  }

  return {
    midiClipDrag,
    midiDragPreview,
    handleMidiClipDragStart,
    updateMidiClipDrag,
    handleMidiClipDrop,
    handleMidiClipDragEnd
  }
}
