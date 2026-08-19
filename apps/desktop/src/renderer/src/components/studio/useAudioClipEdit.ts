import { computed, shallowRef } from "vue"
import type { AudioClipState, TempoMapSnapshot } from "@heron/contracts"
import type { MaybeRefOrGetter } from "vue"
import { toValue } from "vue"
import {
  previewAudioClipFade,
  previewAudioClipTrim,
  type AudioFadeEdge,
  type ClipTrimEdge
} from "../../utils/clipEditing"
import { timelineXToSeconds } from "../../utils/timelineCoordinates"
import { secondsToTimelineX } from "../../utils/timelineCoordinates"
import type { UiGestureIntent } from "@heron/ui"

interface AudioClipEditOptions {
  clip: MaybeRefOrGetter<AudioClipState>
  tempoMap: MaybeRefOrGetter<TempoMapSnapshot>
  pixelsPerQuarter: MaybeRefOrGetter<number>
  projectSampleRate: MaybeRefOrGetter<number>
  commitTrim: (edge: ClipTrimEdge, frame: number) => void
  commitFade: (edge: AudioFadeEdge, frames: number) => void
}

type Gesture =
  | { kind: "trim"; edge: ClipTrimEdge; originTimelineX: number }
  | { kind: "fade"; edge: AudioFadeEdge; originTimelineX: number }

export function useAudioClipEdit(options: AudioClipEditOptions) {
  const gesture = shallowRef<Gesture | null>(null)
  const preview = shallowRef<AudioClipState | null>(null)
  const active = computed(() => gesture.value !== null)

  function frameAtTimelineX(timelineX: number): number {
    const seconds = timelineXToSeconds(
      toValue(options.tempoMap),
      Math.max(0, timelineX),
      toValue(options.pixelsPerQuarter)
    )
    return Math.round(seconds * toValue(options.projectSampleRate))
  }

  function startTrim(edge: ClipTrimEdge): void {
    const clip = toValue(options.clip)
    const frame = edge === "start" ? clip.startFrame : clip.startFrame + clip.lengthFrames
    gesture.value = {
      kind: "trim",
      edge,
      originTimelineX: secondsToTimelineX(
        toValue(options.tempoMap),
        frame / toValue(options.projectSampleRate),
        toValue(options.pixelsPerQuarter)
      )
    }
    preview.value = toValue(options.clip)
  }

  function startFade(edge: AudioFadeEdge): void {
    const clip = toValue(options.clip)
    const frame =
      edge === "in"
        ? clip.startFrame + clip.fadeInFrames
        : clip.startFrame + clip.lengthFrames - clip.fadeOutFrames
    gesture.value = {
      kind: "fade",
      edge,
      originTimelineX: secondsToTimelineX(
        toValue(options.tempoMap),
        frame / toValue(options.projectSampleRate),
        toValue(options.pixelsPerQuarter)
      )
    }
    preview.value = toValue(options.clip)
  }

  function update(deltaX: number): void {
    const current = gesture.value
    if (!current) return
    const clip = toValue(options.clip)
    const pointerFrame = frameAtTimelineX(current.originTimelineX + deltaX)
    preview.value =
      current.kind === "trim"
        ? previewAudioClipTrim(clip, current.edge, pointerFrame)
        : previewAudioClipFade(
            clip,
            current.edge,
            current.edge === "in"
              ? pointerFrame - clip.startFrame
              : clip.startFrame + clip.lengthFrames - pointerFrame
          )
  }

  function finish(deltaX: number): void {
    const current = gesture.value
    if (!current) return
    update(deltaX)
    const value = preview.value
    gesture.value = null
    preview.value = null
    if (!value) return
    if (current.kind === "trim") {
      const frame =
        current.edge === "start" ? value.startFrame : value.startFrame + value.lengthFrames
      options.commitTrim(current.edge, frame)
    } else {
      options.commitFade(
        current.edge,
        current.edge === "in" ? value.fadeInFrames : value.fadeOutFrames
      )
    }
  }

  function cancel(): void {
    gesture.value = null
    preview.value = null
  }

  function handleGesture(
    kind: "trim" | "fade",
    edge: ClipTrimEdge | AudioFadeEdge,
    intent: UiGestureIntent
  ): void {
    if (intent.phase === "start") {
      if (kind === "trim") startTrim(edge as ClipTrimEdge)
      else startFade(edge as AudioFadeEdge)
    } else if (intent.phase === "update") update(intent.delta.x)
    else if (intent.phase === "commit") finish(intent.delta.x)
    else cancel()
  }

  return { active, preview, handleGesture, cancel }
}
