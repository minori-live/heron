import { describe, expect, it, vi } from "vitest"
import {
  analysisHeatmapCell,
  analysisHeatmapImage,
  analysisHeatmapPixels,
  analysisHeatmapStrips,
  invalidateAnalysisHeatmap
} from "./analysisHeatmap"
import { UI_DOMAIN_COLORS } from "./domainColors"

const palette = [UI_DOMAIN_COLORS.audioChannel, UI_DOMAIN_COLORS.busChannel]

describe("analysis heatmap raster mapping", () => {
  it("leaves empty measurement grids empty without allocating invalid image data", () => {
    const heatmap = { columns: 0, rows: 2, values: [] }
    const view = {
      xDomain: [0, 1],
      yDomain: [0, 1],
      viewX: [0, 1],
      viewY: [0, 1],
      width: 800,
      height: 400,
      logarithmic: false
    } as const
    expect(analysisHeatmapImage(heatmap, [-120, 12], palette, view, 1)).toBeUndefined()
    expect(
      analysisHeatmapImage({ ...heatmap, columns: 2, rows: 0 }, [-120, 12], palette, view, 1)
    ).toBeUndefined()
    expect(analysisHeatmapPixels(heatmap, [-120, 12], palette)).toHaveLength(0)
  })

  it("reuses measured colors across viewport changes, recolors new limits, and invalidates edited data", () => {
    const painted: number[][] = []
    const context = {
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4)
      }),
      putImageData: (image: { data: Uint8ClampedArray }) => painted.push([...image.data]),
      drawImage: vi.fn(),
      imageSmoothingEnabled: true
    }
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const heatmap = { columns: 1, rows: 1, values: [-60] }
    const view = {
      xDomain: [0, 1],
      yDomain: [0, 1],
      viewX: [0, 1],
      viewY: [0, 1],
      width: 800,
      height: 400,
      logarithmic: false
    } as const
    try {
      const first = analysisHeatmapImage(heatmap, [-120, 0], palette, view, 1)!
      expect(painted).toEqual([[156, 162, 175, 255]])
      expect([first.width, first.height]).toEqual([800, 400])
      const resized = analysisHeatmapImage(
        heatmap,
        [-120, 0],
        palette,
        { ...view, width: 400, height: 300, viewX: [0.25, 0.75] },
        2,
        first
      )!
      expect([resized.width, resized.height]).toEqual([800, 600])
      expect(painted).toEqual([[156, 162, 175, 255]])
      analysisHeatmapImage(heatmap, [-60, 0], palette, view, 1)
      expect(painted.at(-1)).toEqual([79, 140, 255, 255])
      heatmap.values[0] = 0
      invalidateAnalysisHeatmap(heatmap)
      analysisHeatmapImage(heatmap, [-60, 0], palette, view, 1)
      expect(painted.at(-1)).toEqual([232, 184, 95, 255])
      expect(context.imageSmoothingEnabled).toBe(false)
    } finally {
      getContext.mockRestore()
    }
  })

  it("resolves measured time centers and frequency bands without clipping levels or filling gaps", () => {
    const heatmap = { columns: 3, rows: 2, values: [-160, 24, -54, NaN, 3.14159265, -42] }
    expect(analysisHeatmapCell(heatmap, [0, 6], [0, 24000], 0, 18000)).toEqual([
      0, 18000, 24, 0, 1.5, 12000, 24000
    ])
    expect(analysisHeatmapCell(heatmap, [0, 6], [0, 24000], 5, 6000)).toEqual([
      6, 6000, 3.14159265, 4.5, 6, 0, 12000
    ])
    expect(analysisHeatmapCell(heatmap, [0, 6], [0, 24000], 3, 18000)).toBeUndefined()
    expect(analysisHeatmapCell(heatmap, [0, 6], [0, 24000], -0.001, 6000)).toBeUndefined()
    expect(analysisHeatmapCell(heatmap, [0, 6], [0, 24000], 3, 24001)).toBeUndefined()
    expect(analysisHeatmapCell(heatmap, [0, 6], [0, 24000], 6, 24000)?.[2]).toBe(-42)
    expect(
      analysisHeatmapCell({ columns: 1, rows: 1, values: [-30] }, [0, 6], [0, 24000], 5, 12000)
    ).toEqual([0, 12000, -30, 0, 6, 0, 24000])
  })

  it("maps every cell to bounded colors, flips frequency rows, and retains transparent missing cells", () => {
    const heatmap = { columns: 2, rows: 2, values: [-160, 24, -54, NaN] }
    expect([...analysisHeatmapPixels(heatmap, [-120, 12], palette)]).toEqual([
      232, 184, 95, 255, 0, 0, 0, 0, 79, 140, 255, 255, 156, 162, 175, 255
    ])
    expect(heatmap.values).toEqual([-160, 24, -54, NaN])
  })

  it("clips the raster to zoomed domains and preserves half-width edge time cells", () => {
    const heatmap = { columns: 3, rows: 2 }
    const view = {
      xDomain: [0, 6],
      yDomain: [0, 24000],
      viewX: [2, 4],
      viewY: [6000, 18000],
      width: 800,
      height: 400,
      logarithmic: false
    } as const
    expect(analysisHeatmapStrips(heatmap, view)).toEqual([[1, 0.5, 1, 1, 0, 0, 800, 400]])
    expect(analysisHeatmapStrips(heatmap, { ...view, viewX: [0, 6], viewY: [0, 24000] })).toEqual([
      [0, 0, 1, 2, 0, 0, 200, 400],
      [1, 0, 1, 2, 200, 0, 400, 400],
      [2, 0, 1, 2, 600, 0, 200, 400]
    ])
    expect(analysisHeatmapStrips(heatmap, { ...view, viewY: [25000, 30000] })).toEqual([])
    expect(analysisHeatmapStrips(heatmap, { ...view, viewX: [7, 8] })).toEqual([])
  })

  it("uses logarithmic positions for time cells when a heatmap requests a logarithmic x axis", () => {
    const strips = analysisHeatmapStrips(
      { columns: 2, rows: 1 },
      {
        xDomain: [1, 100],
        yDomain: [0, 1],
        viewX: [1, 100],
        viewY: [0, 1],
        width: 800,
        height: 400,
        logarithmic: true
      }
    )
    const boundary = (Math.log(50.5) / Math.log(100)) * 800
    expect(strips[0]?.[6]).toBeCloseTo(boundary)
    expect(strips[1]?.[4]).toBeCloseTo(boundary)
    expect(strips[1]?.[6]).toBeCloseTo(800 - boundary)
  })
})
