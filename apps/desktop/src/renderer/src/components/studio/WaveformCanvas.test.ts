import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WaveformPeakWindow } from "@heron/contracts"
import WaveformCanvas from "./WaveformCanvas.vue"

function encode(values: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer)
}

const peaks: WaveformPeakWindow = {
  id: "asset",
  sampleRate: 48_000,
  channels: 2,
  frameCount: 128,
  startFrame: 0,
  endFrame: 128,
  framesPerBucket: 64,
  bucketCount: 2,
  peaks: encode([-1, 0.5, -0.25, 0.25, -0.5, 0.75, -0.75, 1])
}

describe("WaveformCanvas", () => {
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1
  }

  beforeEach(() => {
    Object.values(context).forEach((value) => {
      if (typeof value === "function" && "mockClear" in value) value.mockClear()
    })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    )
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 })
    class TestResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback(
          [
            {
              target,
              contentRect: { width: 120, height: 60 }
            } as ResizeObserverEntry
          ],
          this
        )
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("uses DPR-aware backing pixels and redraws for resize, mode, and amplitude", async () => {
    const wrapper = mount(WaveformCanvas, {
      props: {
        window: peaks,
        displayMode: "separate",
        amplitudeScale: 1,
        loading: false
      }
    })
    await nextTick()
    const canvas = wrapper.get("canvas").element as HTMLCanvasElement
    expect(canvas.width).toBe(240)
    expect(canvas.height).toBe(120)
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(wrapper.get("canvas").attributes("aria-label")).toContain("2 channels, 128 frames")

    const strokes = context.stroke.mock.calls.length
    await wrapper.setProps({ displayMode: "aggregate", amplitudeScale: 2 })
    await nextTick()
    expect(context.stroke.mock.calls.length).toBeGreaterThan(strokes)
  })

  it("resolves a visible recording color before drawing into the canvas", async () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      color: "rgb(17, 17, 17)",
      getPropertyValue: (property: string) =>
        property === "--ui-domain-waveform-record-peak" ? "rgb(255, 210, 216)" : ""
    } as CSSStyleDeclaration)
    const wrapper = mount(WaveformCanvas, {
      props: {
        window: peaks,
        displayMode: "separate",
        amplitudeScale: 1,
        loading: false,
        recording: true
      }
    })
    await nextTick()

    expect(context.strokeStyle).toBe("rgb(255, 210, 216)")
    wrapper.unmount()
  })

  it("selects source peaks after scrolling across a tempo change, including a negative source origin", async () => {
    const wrapper = mount(WaveformCanvas, {
      props: {
        window: {
          id: "trimmed-asset",
          sampleRate: 48_000,
          channels: 1,
          frameCount: 12 * 48_000,
          startFrame: 8 * 48_000,
          endFrame: 12 * 48_000,
          framesPerBucket: 48_000,
          bucketCount: 4,
          peaks: encode([-0.125, 0.125, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75])
        },
        displayMode: "aggregate",
        amplitudeScale: 1,
        loading: false,
        tempoMap: {
          ticksPerQuarter: 960,
          tempoEvents: [
            { tick: 0, beatsPerMinute: 120 },
            { tick: 3_840, beatsPerMinute: 60 }
          ],
          timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
        },
        pixelsPerQuarter: 30,
        timelineStartX: 60,
        sourceStartSeconds: -8
      }
    })
    await nextTick()

    const expectAmplitudeAt = (x: number, amplitude: number): void => {
      expect(context.moveTo).toHaveBeenCalledWith(x, 30 - amplitude * 30)
      expect(context.lineTo).toHaveBeenCalledWith(x, 30 + amplitude * 30)
    }

    // Timeline seconds 1–4 show source seconds 9–12. The tempo change makes
    // the first source second occupy 60 pixels and the later seconds 30 each.
    expectAmplitudeAt(0.5, 0.25)
    expectAmplitudeAt(60.5, 0.5)
    expectAmplitudeAt(90.5, 0.75)

    context.moveTo.mockClear()
    context.lineTo.mockClear()
    await wrapper.setProps({ sourceStartSeconds: -7 })
    await nextTick()

    // Moving the source origin alone must redraw source seconds 8–11.
    expectAmplitudeAt(0.5, 0.125)
    expectAmplitudeAt(60.5, 0.25)
    expectAmplitudeAt(90.5, 0.5)
    wrapper.unmount()
  })

  it("announces loading and unavailable empty states without fake peaks", async () => {
    const wrapper = mount(WaveformCanvas, {
      props: {
        window: null,
        displayMode: "separate",
        amplitudeScale: 1,
        loading: true
      }
    })
    expect(wrapper.get("canvas").attributes("aria-label")).toBe("Waveform loading")
    expect(context.lineTo).not.toHaveBeenCalled()
    await wrapper.setProps({ loading: false })
    expect(wrapper.get("canvas").attributes("aria-label")).toBe("Waveform unavailable")
  })
})
