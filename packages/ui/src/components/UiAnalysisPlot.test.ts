import { enableAutoUnmount, mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import UiAnalysisPlot from "./UiAnalysisPlot.vue"

enableAutoUnmount(afterEach)

let resize: (entries: { contentRect: { width: number; height: number } }[]) => void
const observe = vi.fn()
const disconnect = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resize) {
        resize = callback
      }
      observe = observe
      disconnect = disconnect
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const responseProps = {
  label: "Stereo response",
  xLabel: "Frequency (Hz)",
  yLabel: "Level (dB)",
  series: []
}

function captureHeatmap() {
  const frames: ImageData[] = []
  const urls: string[] = []
  const context = {
    createImageData: (width: number, height: number) => ({
      width,
      height,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4)
    }),
    putImageData: (pixels: ImageData) => frames.push(pixels)
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
    const url = `data:image/png;base64,${btoa(String(frames.length))}`
    urls.push(url)
    return url
  })
  return { frames, urls }
}

function pixel(frame: ImageData, x: number, y: number) {
  const offset = (y * frame.width + x) * 4
  return {
    red: frame.data[offset]!,
    green: frame.data[offset + 1]!,
    blue: frame.data[offset + 2]!,
    alpha: frame.data[offset + 3]!
  }
}

describe("UiAnalysisPlot", () => {
  it("labels the response and keeps empty or nonfinite measurements on readable axes", async () => {
    const plot = mount(UiAnalysisPlot, { props: responseProps })
    const labels = () => plot.findAll("text").map((label) => label.text())

    expect(plot.get('[role="img"]').attributes("aria-label")).toBe("Stereo response")
    expect(labels()).toEqual(
      expect.arrayContaining(["Frequency (Hz)", "Level (dB)", "20", "20k", "-1", "1"])
    )

    await plot.setProps({
      series: [
        {
          label: "L",
          x: [20, Number.NaN, 20000, Number.POSITIVE_INFINITY],
          y: [-10, null, 0, Number.NaN, Number.POSITIVE_INFINITY]
        }
      ]
    })

    expect(labels()).toEqual(expect.arrayContaining(["20", "20k"]))
    // Leave headroom below the lowest finite measurement.
    const numericLabels = labels().map(Number).filter(Number.isFinite)
    expect(Math.min(...numericLabels)).toBeLessThan(-10)
    expect(labels().join(" ")).not.toMatch(/NaN|Infinity/)
  })

  it("uses the requested measurement domains and logarithmic frequency labels", () => {
    const plot = mount(UiAnalysisPlot, {
      props: {
        ...responseProps,
        logarithmic: true,
        xDomain: [20, 20000],
        yDomain: [-60, 0],
        series: [{ label: "L", x: [100, 1000], y: [-20, -30] }]
      }
    })
    const labels = plot.findAll("text").map((label) => label.text())

    expect(labels).toEqual(
      expect.arrayContaining(["20", "50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"])
    )
    expect(labels).toEqual(expect.arrayContaining(["-60", "-50", "-40", "-30", "-20", "-10", "0"]))
  })

  it("fits its host, preserves minimum plotting dimensions, and releases observation on unmount", async () => {
    const plot = mount(UiAnalysisPlot, { props: responseProps })
    expect(observe).toHaveBeenCalledExactlyOnceWith(plot.element)

    resize([{ contentRect: { width: 1100, height: 600 } }])
    await nextTick()
    expect(plot.get("svg").attributes("viewBox")).toBe("0 0 1100 600")

    resize([{ contentRect: { width: 0, height: 0 } }])
    await nextTick()
    expect(plot.get("svg").attributes("viewBox")).toBe("0 0 320 200")

    resize([])
    await nextTick()
    expect(plot.get("svg").attributes("viewBox")).toBe("0 0 320 200")
    plot.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("maps column-major energy upward, clamps missing and out-of-range bins, and repaints changed data", async () => {
    const { frames, urls } = captureHeatmap()
    const plot = mount(UiAnalysisPlot, {
      props: {
        ...responseProps,
        label: "Sweep spectrum",
        xLabel: "Time (s)",
        yLabel: "Frequency (Hz)",
        xDomain: [0, 6],
        yDomain: [0, 24000],
        heatmap: { columns: 2, rows: 2, values: [-200, 24, -54] }
      }
    })
    await nextTick()

    const first = frames[0]!
    expect([first.width, first.height]).toEqual([2, 2])
    // High frequency bins occupy the top row; low energy is blue, high energy red.
    const high = pixel(first, 0, 0)
    expect(high.red).toBeGreaterThan(high.green)
    expect(high.red).toBeGreaterThan(high.blue)
    expect(high.alpha).toBe(255)
    const low = pixel(first, 0, 1)
    expect(low.blue).toBeGreaterThan(low.red)
    expect(low.blue).toBeGreaterThan(low.green)
    expect(pixel(first, 1, 0)).toEqual(low)
    const middle = pixel(first, 1, 1)
    expect(middle.green).toBeGreaterThan(middle.red)
    expect(middle.green).toBeGreaterThan(middle.blue)
    const initialUrl = plot.get("image").attributes("href")
    expect(initialUrl).toBe(urls.at(-1))
    expect(plot.text()).toContain("-120")

    await plot.setProps({ colorDomain: [-120, 168] })
    const rescaled = pixel(frames.at(-1)!, 0, 0)
    expect(rescaled.green).toBeGreaterThan(rescaled.red)
    expect(rescaled.green).toBeGreaterThan(rescaled.blue)
    const rescaledUrl = plot.get("image").attributes("href")
    expect(rescaledUrl).toBe(urls.at(-1))
    expect(rescaledUrl).not.toBe(initialUrl)
    expect(plot.text()).toContain("168")

    await plot.setProps({ heatmap: { columns: 1, rows: 2, values: [-120, 168] } })
    const replacement = frames.at(-1)!
    expect([replacement.width, replacement.height]).toEqual([1, 2])
    expect(pixel(replacement, 0, 0)).toEqual(high)
    expect(pixel(replacement, 0, 1)).toEqual(low)
    expect(plot.get("image").attributes("href")).toBe(urls.at(-1))
    expect(plot.get("image").attributes("href")).not.toBe(rescaledUrl)

    await plot.setProps({ heatmap: undefined })
    expect(plot.find("image").exists()).toBe(false)
    expect(plot.text()).not.toContain("168")
    expect(plot.text()).toContain("Time (s)")
  })

  it("retains the labeled axes when heatmap rasterization is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    const plot = mount(UiAnalysisPlot, {
      props: {
        ...responseProps,
        heatmap: { columns: 1, rows: 1, values: [-60] }
      }
    })

    expect(plot.get('[role="img"]').attributes("aria-label")).toBe("Stereo response")
    expect(plot.text()).toContain("Frequency (Hz)")
    expect(plot.text()).toContain("Level (dB)")
    expect(plot.find("image").exists()).toBe(false)
  })
})
