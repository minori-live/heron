import { readonly, shallowRef } from "vue"
import type { MidiClipState } from "@heron/contracts"
import type { PianoRollSnap } from "../../utils/pianoRoll"
import { snapTicks } from "../../utils/pianoRoll"
import { type ClipTrimEdge, previewMidiClipTrim } from "../../utils/clipEditing"
import type { UiGestureIntent } from "@heron/ui"

interface UseMidiClipTrimOptions {
  clip: () => MidiClipState
  pixelsPerQuarter: () => number
  ticksPerQuarter: () => number
  snap: () => PianoRollSnap
  commit: (edge: ClipTrimEdge, tick: number) => void
}

interface ActiveTrim {
  edge: ClipTrimEdge
  edgeStartTick: number
}

export function useMidiClipTrim(options: UseMidiClipTrimOptions) {
  const preview = shallowRef<MidiClipState | null>(null)
  const active = shallowRef<ActiveTrim | null>(null)

  function requestedTick(deltaX: number, trim: ActiveTrim): number {
    const ticksPerQuarter = Math.max(1, options.ticksPerQuarter())
    const pixelsPerTick = options.pixelsPerQuarter() / ticksPerQuarter
    const rawTick = trim.edgeStartTick + deltaX / Math.max(Number.EPSILON, pixelsPerTick)
    return snapTicks(rawTick, options.snap())
  }

  function start(edge: ClipTrimEdge): void {
    const clip = options.clip()
    active.value = {
      edge,
      edgeStartTick: edge === "start" ? clip.startTick : clip.startTick + clip.lengthTicks
    }
    preview.value = clip
  }

  function update(deltaX: number): void {
    const trim = active.value
    if (!trim) return
    preview.value = previewMidiClipTrim(options.clip(), trim.edge, requestedTick(deltaX, trim))
  }

  function finish(deltaX: number): void {
    const trim = active.value
    if (!trim) return
    update(deltaX)
    const value = preview.value
    active.value = null
    preview.value = null
    if (!value) return
    options.commit(
      trim.edge,
      trim.edge === "start" ? value.startTick : value.startTick + value.lengthTicks
    )
  }

  function cancel(): void {
    active.value = null
    preview.value = null
  }

  function gesture(edge: ClipTrimEdge, intent: UiGestureIntent): void {
    if (intent.phase === "start") start(edge)
    else if (intent.phase === "update") update(intent.delta.x)
    else if (intent.phase === "commit") finish(intent.delta.x)
    else cancel()
  }

  return {
    active: readonly(active),
    preview: readonly(preview),
    gesture,
    cancel
  }
}
