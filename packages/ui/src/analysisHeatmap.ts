import { color } from "echarts/core"
import { fractionAtValue, type AnalysisDomain } from "./analysisView"
import type { UiAnalysisHeatmap } from "./types"

/** Resolve the original FFT cell, independent of display colors, size and zoom. */
export function analysisHeatmapCell(
  heatmap: UiAnalysisHeatmap,
  xDomain: AnalysisDomain,
  yDomain: AnalysisDomain,
  x: number,
  y: number
): number[] | undefined {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    heatmap.columns < 1 ||
    heatmap.rows < 1 ||
    x < xDomain[0] ||
    x > xDomain[1] ||
    y < yDomain[0] ||
    y > yDomain[1]
  )
    return undefined
  const dx = (xDomain[1] - xDomain[0]) / Math.max(1, heatmap.columns - 1)
  const dy = (yDomain[1] - yDomain[0]) / heatmap.rows
  const column = Math.min(heatmap.columns - 1, Math.round((x - xDomain[0]) / dx))
  const row = Math.min(heatmap.rows - 1, Math.floor((y - yDomain[0]) / dy))
  const value = heatmap.values[column * heatmap.rows + row]
  if (value === undefined || !Number.isFinite(value)) return undefined
  const center = xDomain[0] + column * dx
  const bottom = yDomain[0] + row * dy
  return [
    center,
    bottom + dy / 2,
    value,
    column === 0 ? xDomain[0] : center - dx / 2,
    column === heatmap.columns - 1 ? xDomain[1] : center + dx / 2,
    bottom,
    bottom + dy
  ]
}

/** One pixel per measured cell; uses the same interpolation as ECharts visualMap. */
export function analysisHeatmapPixels(
  heatmap: UiAnalysisHeatmap,
  domain: AnalysisDomain,
  palette: readonly string[]
): Uint8ClampedArray {
  if (heatmap.columns < 1 || heatmap.rows < 1) return new Uint8ClampedArray()
  const pixels = new Uint8ClampedArray(heatmap.columns * heatmap.rows * 4)
  const colors = palette.map((value) => color.parse(value) ?? [0, 0, 0, 0])
  const rgba: number[] = []
  for (let column = 0; column < heatmap.columns; column++) {
    for (let row = 0; row < heatmap.rows; row++) {
      const value = heatmap.values[column * heatmap.rows + row]
      if (value === undefined || !Number.isFinite(value)) continue
      const normalized = Math.max(0, Math.min(1, (value - domain[0]) / (domain[1] - domain[0])))
      color.fastLerp(normalized, colors, rgba)
      const offset = ((heatmap.rows - 1 - row) * heatmap.columns + column) * 4
      pixels[offset] = rgba[0]!
      pixels[offset + 1] = rgba[1]!
      pixels[offset + 2] = rgba[2]!
      pixels[offset + 3] = Math.round(rgba[3]! * 255)
    }
  }
  return pixels
}

export interface HeatmapView {
  xDomain: AnalysisDomain
  yDomain: AnalysisDomain
  viewX: AnalysisDomain
  viewY: AnalysisDomain
  width: number
  height: number
  logarithmic: boolean
}

/** Source/destination rectangles for exact first/last half-width time cells. */
export function analysisHeatmapStrips(
  heatmap: Pick<UiAnalysisHeatmap, "columns" | "rows">,
  view: HeatmapView
): [number, number, number, number, number, number, number, number][] {
  const { xDomain, yDomain, viewX, viewY, width, height, logarithmic } = view
  const low = Math.max(yDomain[0], viewY[0])
  const high = Math.min(yDomain[1], viewY[1])
  if (low >= high) return []
  const sourceY = ((yDomain[1] - high) / (yDomain[1] - yDomain[0])) * heatmap.rows
  const sourceHeight = ((high - low) / (yDomain[1] - yDomain[0])) * heatmap.rows
  const top = (1 - fractionAtValue(viewY, high, false)) * height
  const bottom = (1 - fractionAtValue(viewY, low, false)) * height
  const dx = (xDomain[1] - xDomain[0]) / Math.max(1, heatmap.columns - 1)
  const strips: ReturnType<typeof analysisHeatmapStrips> = []
  for (let column = 0; column < heatmap.columns; column++) {
    const center = xDomain[0] + column * dx
    const left = Math.max(viewX[0], column === 0 ? xDomain[0] : center - dx / 2)
    const right = Math.min(viewX[1], column === heatmap.columns - 1 ? xDomain[1] : center + dx / 2)
    if (left >= right) continue
    const x0 = fractionAtValue(viewX, left, logarithmic) * width
    const x1 = fractionAtValue(viewX, right, logarithmic) * width
    strips.push([column, sourceY, 1, sourceHeight, x0, top, x1 - x0, bottom - top])
  }
  return strips
}

const sources = new WeakMap<UiAnalysisHeatmap, { key: string; source: HTMLCanvasElement }>()

export function invalidateAnalysisHeatmap(heatmap: UiAnalysisHeatmap): void {
  sources.delete(heatmap)
}

/** Cache cell colors, then repaint only the viewport; never interpolate measurements. */
export function analysisHeatmapImage(
  heatmap: UiAnalysisHeatmap,
  domain: AnalysisDomain,
  palette: readonly string[],
  view: HeatmapView,
  pixelRatio: number,
  canvas = document.createElement("canvas")
): HTMLCanvasElement | undefined {
  if (heatmap.columns < 1 || heatmap.rows < 1) return undefined
  const key = JSON.stringify([domain, palette, heatmap.columns, heatmap.rows])
  let cached = sources.get(heatmap)
  if (!cached || cached.key !== key) {
    const source = document.createElement("canvas")
    source.width = heatmap.columns
    source.height = heatmap.rows
    const context = source.getContext("2d")
    if (!context) return undefined
    const image = context.createImageData(source.width, source.height)
    image.data.set(analysisHeatmapPixels(heatmap, domain, palette))
    context.putImageData(image, 0, 0)
    cached = { key, source }
    sources.set(heatmap, cached)
  }
  canvas.width = Math.max(1, Math.round(view.width * pixelRatio))
  canvas.height = Math.max(1, Math.round(view.height * pixelRatio))
  const context = canvas.getContext("2d")
  if (!context) return undefined
  context.imageSmoothingEnabled = false
  for (const strip of analysisHeatmapStrips(heatmap, {
    ...view,
    width: canvas.width,
    height: canvas.height
  })) {
    context.drawImage(cached.source, ...strip)
  }
  return canvas
}
