import { clamp, easeInOut, smoothstep } from "./home-motion"

/**
 * The hero desk plays one scripted loop: a take is recorded in Studio, an EQ
 * band is shaped, Live switches to the Chorus Patch, and Plugin Analysis sweeps
 * a response. Every window and cursor derives its state from the same loop time
 * so the cursors appear to operate the windows they touch.
 */
export const LOOP = 14
export const REST_TIME = 10.6

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  w: number
  h: number
}

/** Window rectangles in percent of the desk stage. */
export const deskWindows = {
  eq: { x: 3, y: 15, w: 31, h: 43 },
  studio: { x: 28, y: 5, w: 45, h: 56 },
  live: { x: 67, y: 20, w: 30, h: 52 },
  analysis: { x: 16, y: 57, w: 34, h: 40 }
} satisfies Record<string, Rect>

/** Controls the cursors operate, in percent of the desk stage. */
export interface DeskTargets {
  record: Point
  patch: Point
  eqPlot: Rect
  analysisPlot: Rect
}

const at = (rect: Rect, fx: number, fy: number): Point => ({
  x: rect.x + rect.w * fx,
  y: rect.y + rect.h * fy
})

const inset = (rect: Rect, l: number, t: number, r: number, b: number): Rect => ({
  x: rect.x + rect.w * l,
  y: rect.y + rect.h * t,
  w: rect.w * (1 - l - r),
  h: rect.h * (1 - t - b)
})

/** Approximate targets used until the rendered windows can be measured. */
export const fallbackTargets: DeskTargets = {
  record: at(deskWindows.studio, 0.15, 0.1),
  patch: at(deskWindows.live, 0.2, 0.62),
  eqPlot: inset(deskWindows.eq, 0.03, 0.2, 0.03, 0.26),
  analysisPlot: inset(deskWindows.analysis, 0.03, 0.22, 0.27, 0.06)
}

export const RECORD_START = 0.46
const RECORD_AT = 2.4
const RECORD_STOP = 11.4
/** Lane fraction covered by a complete take. */
export const TAKE_LENGTH = 0.34
const RECORD_RATE = TAKE_LENGTH / (RECORD_STOP - RECORD_AT)

/** Studio's playhead as a lane fraction; it cycles through the loop region. */
export const playheadPosition = (t: number): number =>
  RECORD_START + ((t % LOOP) - RECORD_AT) * RECORD_RATE

/** Length of the take recorded so far, as a lane fraction. */
export const recordedFraction = (t: number): number =>
  clamp(((t % LOOP) - RECORD_AT) / (RECORD_STOP - RECORD_AT)) * TAKE_LENGTH

export const isRecording = (t: number): boolean => {
  const local = t % LOOP
  return local >= RECORD_AT && local < RECORD_STOP
}

/** EQ band 2 sits at this fraction of the plot width; the cursor drags its gain. */
export const EQ_DRAG_BAND_X = 0.31
const DRAG_FROM = 4.2
const DRAG_TO = 7.4

export function eqDragGain(t: number): number {
  const local = t % LOOP
  const drag = smoothstep(DRAG_FROM, 5.4, local) - smoothstep(6, DRAG_TO, local) * 0.45
  return 3 + drag * 6.5
}

/** Vertical position of a gain in the ±18 dB EQ plot, as a fraction from the top. */
export const eqGainToY = (gain: number): number => 0.5 - gain / 36

/** Live's Chorus Patch becomes active when the cursor clicks it. */
export const PATCH_AT = 8.8
export const chorusActive = (t: number): boolean => t % LOOP >= PATCH_AT

/** Plugin Analysis sweep position between 0 and 1, or -1 when idle. */
export function analysisSweep(t: number): number {
  const local = t % LOOP
  return local < 10.2 || local > 13 ? -1 : (local - 10.2) / 2.8
}

export type CursorKey = "record" | "shape" | "patch" | "measure"

export interface CursorState extends Point {
  key: CursorKey
  labelVisible: boolean
  pressed: number
}

interface Waypoint extends Point {
  t: number
}

const eqNode = (plot: Rect, t: number): Point => ({
  x: plot.x + plot.w * EQ_DRAG_BAND_X,
  y: plot.y + plot.h * eqGainToY(eqDragGain(t))
})

const measurePoint = (plot: Rect, sweep: number): Point => ({
  x: plot.x + plot.w * sweep,
  y: plot.y + plot.h * 0.66
})

function cursorPaths(targets: DeskTargets): Record<CursorKey, Waypoint[]> {
  const { studio, eq, live, analysis } = deskWindows
  const plot = targets.analysisPlot
  return {
    record: [
      { t: 0, ...at(studio, 0.55, 0.88) },
      { t: 1.6, ...targets.record },
      { t: 3.2, ...targets.record },
      { t: 5, ...at(studio, 0.4, 0.55) },
      { t: 11, ...at(studio, 0.62, 0.66) },
      { t: LOOP, ...at(studio, 0.55, 0.88) }
    ],
    shape: [
      { t: 0, ...at(eq, 0.72, 0.92) },
      { t: 3.2, ...at(eq, 0.6, 0.82) },
      { t: DRAG_FROM, ...eqNode(targets.eqPlot, DRAG_FROM) },
      { t: DRAG_TO, ...eqNode(targets.eqPlot, DRAG_TO) },
      { t: 10, ...at(eq, 0.76, 0.88) },
      { t: LOOP, ...at(eq, 0.72, 0.92) }
    ],
    patch: [
      { t: 0, ...at(live, 0.72, 0.9) },
      { t: 6.6, ...at(live, 0.64, 0.82) },
      { t: 8.2, ...targets.patch },
      { t: 9.4, ...targets.patch },
      { t: 11, ...at(live, 0.7, 0.5) },
      { t: LOOP, ...at(live, 0.72, 0.9) }
    ],
    measure: [
      { t: 0, ...at(analysis, 0.82, 0.86) },
      { t: 9.2, ...at(analysis, 0.8, 0.84) },
      { t: 10.2, ...measurePoint(plot, 0) },
      { t: 13, ...measurePoint(plot, 1) },
      { t: LOOP, ...at(analysis, 0.82, 0.86) }
    ]
  }
}

const clicks: Partial<Record<CursorKey, number>> = { record: RECORD_AT, patch: PATCH_AT }

const labelWindows: Record<CursorKey, [number, number]> = {
  record: [1.4, 5.2],
  shape: [3.8, 7.6],
  patch: [7.6, 11],
  measure: [10, 13.4]
}

function follow(points: Waypoint[], t: number): Point {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (t <= b.t) {
      const k = easeInOut(clamp((t - a.t) / (b.t - a.t)))
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
  }
  return points.at(-1)!
}

export function cursorStates(t: number, targets: DeskTargets): CursorState[] {
  const local = t % LOOP
  const paths = cursorPaths(targets)
  return (Object.keys(paths) as CursorKey[]).map((key) => {
    const dragging = key === "shape" && local >= DRAG_FROM && local <= DRAG_TO
    const sweep = key === "measure" ? analysisSweep(local) : -1
    const point = dragging
      ? eqNode(targets.eqPlot, local)
      : sweep >= 0
        ? measurePoint(targets.analysisPlot, sweep)
        : follow(paths[key], local)
    const click = clicks[key]
    const sinceClick = click === undefined ? -1 : local - click
    const [from, to] = labelWindows[key]
    return {
      key,
      ...point,
      labelVisible: local >= from && local <= to,
      pressed: dragging ? 1 : sinceClick >= 0 && sinceClick < 0.4 ? 1 - sinceClick / 0.4 : 0
    }
  })
}
