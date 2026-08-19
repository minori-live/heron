import { describe, expect, it, vi } from "vitest"
import type { AudioClipState, TempoMapSnapshot } from "@heron/contracts"
import type { UiGestureIntent, UiGesturePhase } from "@heron/ui"
import { useAudioClipEdit } from "./useAudioClipEdit"

const tempoMap: TempoMapSnapshot = {
  ticksPerQuarter: 960,
  tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
  timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
}
const clip: AudioClipState = {
  id: "audio-1",
  assetId: "asset-1",
  trackId: "track-1",
  name: "Take",
  startFrame: 48_000,
  sourceOffsetFrames: 0,
  lengthFrames: 48_000,
  sourceLengthFrames: 96_000,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  assetSampleRate: 48_000,
  assetChannels: 2
}
const intent = (phase: UiGesturePhase, x: number): UiGestureIntent => ({
  phase,
  point: { x, y: 0 },
  delta: { x, y: 0 },
  modifiers: { alt: false, control: false, meta: false, shift: false }
})
function createEdit(commitTrim = vi.fn(), commitFade = vi.fn()) {
  return {
    edit: useAudioClipEdit({
      clip: () => clip,
      tempoMap: () => tempoMap,
      pixelsPerQuarter: () => 480,
      projectSampleRate: () => 48_000,
      commitTrim,
      commitFade
    }),
    commitTrim,
    commitFade
  }
}

describe("useAudioClipEdit", () => {
  it("previews and commits frame-accurate normalized trim intents", () => {
    const { edit, commitTrim } = createEdit()
    edit.handleGesture("trim", "start", intent("start", 0))
    edit.handleGesture("trim", "start", intent("update", 240))
    expect(edit.preview.value).toMatchObject({ startFrame: 60_000, lengthFrames: 36_000 })
    edit.handleGesture("trim", "start", intent("commit", 240))
    expect(commitTrim).toHaveBeenCalledWith("start", 60_000)
  })

  it("previews fade intents and rolls back cancellation", () => {
    const { edit, commitFade } = createEdit()
    edit.handleGesture("fade", "in", intent("start", 0))
    edit.handleGesture("fade", "in", intent("update", 240))
    expect(edit.preview.value).toMatchObject({ fadeInFrames: 12_000 })
    edit.handleGesture("fade", "in", intent("cancel", 240))
    expect(edit.preview.value).toBeNull()
    expect(commitFade).not.toHaveBeenCalled()
  })
})
