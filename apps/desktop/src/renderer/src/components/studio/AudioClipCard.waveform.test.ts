import { mount } from "@vue/test-utils"
import { createPinia } from "pinia"
import { nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WaveformPeakWindow } from "@heron/contracts"
import type { TimelineClip } from "../../stores/transport"
import { useWaveformStore } from "../../stores/waveform"
import AudioClipCard from "./AudioClipCard.vue"

const clip: TimelineClip = {
  id: "clip-1",
  assetId: "asset-1",
  trackId: "track-1",
  name: "Take",
  startSeconds: 1,
  durationSeconds: 4,
  endSeconds: 5,
  channels: 1,
  sampleRate: 96_000,
  projectSampleRate: 48_000,
  startFrame: 48_000,
  sourceOffsetFrames: 0,
  lengthFrames: 192_000,
  sourceLengthFrames: 192_000,
  fadeInFrames: 0,
  fadeOutFrames: 0
}

function peakWindow(startFrame: number, amplitudes: number[]): WaveformPeakWindow {
  return {
    id: clip.assetId,
    sampleRate: clip.sampleRate,
    channels: 1,
    frameCount: 384_000,
    startFrame,
    endFrame: 384_000,
    framesPerBucket: 48_000,
    bucketCount: amplitudes.length,
    peaks: new Uint8Array(new Float32Array(amplitudes.flatMap((value) => [-value, value])).buffer)
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("AudioClipCard waveform source alignment", () => {
  it("keeps the remaining source peaks aligned during a left trim and after its window refresh", async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    const fullWindow = peakWindow(0, [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1])
    const trimmedWindow = peakWindow(288_000, [0.875, 1])
    let resolveTrimmed!: (window: WaveformPeakWindow) => void
    const loadAsset = vi
      .spyOn(useWaveformStore(pinia), "loadAsset")
      .mockResolvedValueOnce(fullWindow)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveTrimmed = resolve)))
    let width = 480
    let points: number[][] = []
    let drawnPeaks: number[][] = []
    const context = {
      setTransform() {},
      clearRect() {},
      beginPath() {
        points = []
      },
      moveTo(x: number, y: number) {
        points.push([x, y])
      },
      lineTo() {},
      stroke() {
        drawnPeaks = points
      }
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    )
    vi.spyOn(HTMLCanvasElement.prototype, "clientWidth", "get").mockImplementation(() => width)
    vi.spyOn(HTMLCanvasElement.prototype, "clientHeight", "get").mockReturnValue(60)
    const wrapper = mount(AudioClipCard, {
      props: {
        clip,
        tempoMap: {
          ticksPerQuarter: 960,
          tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
          timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
        },
        pixelsPerQuarter: 60,
        viewportStartSeconds: 0,
        viewportEndSeconds: 6,
        amplitudeScale: 1,
        displayMode: "separate",
        selected: true,
        trackColor: "#73d6a2",
        playheadFrame: 0
      },
      global: { plugins: [pinia] }
    })

    try {
      await vi.advanceTimersByTimeAsync(40)
      await nextTick()
      expect(drawnPeaks[0]).toEqual([0.5, 26.25])

      const handle = wrapper.get('[aria-label="Trim the start of Take"]')
      await handle.trigger("pointerdown", { pointerId: 7, clientX: 120 })
      width = 120
      await handle.trigger("pointermove", { pointerId: 7, clientX: 480 })
      await nextTick()

      // Before another request resolves, the retained window must already show the
      // final second of the source, not replay its first second at the new start.
      expect(drawnPeaks).toHaveLength(120)
      expect(drawnPeaks[0]).toEqual([0.5, 3.75])
      expect(drawnPeaks.at(-1)).toEqual([119.5, 0])

      await handle.trigger("pointerup", { pointerId: 7, clientX: 480 })
      expect(wrapper.emitted("trim")).toEqual([[clip.id, "start", 192_000]])
      await wrapper.setProps({
        clip: {
          ...clip,
          startFrame: 192_000,
          sourceOffsetFrames: 144_000,
          lengthFrames: 48_000,
          startSeconds: 4,
          durationSeconds: 1
        }
      })
      await vi.advanceTimersByTimeAsync(40)
      expect(loadAsset).toHaveBeenLastCalledWith({
        id: clip.assetId,
        startFrame: 288_000,
        endFrame: 384_000,
        maxBuckets: 120
      })

      resolveTrimmed(trimmedWindow)
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()
      expect(drawnPeaks).toHaveLength(120)
      expect(drawnPeaks[0]).toEqual([0.5, 3.75])
      expect(drawnPeaks.at(-1)).toEqual([119.5, 0])
    } finally {
      wrapper.unmount()
    }
  })
})
