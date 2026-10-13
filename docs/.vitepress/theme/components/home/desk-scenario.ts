import { clamp, smoothstep } from "./home-motion"

/**
 * The hero desk plays one scripted loop: a take is recorded in Studio, an EQ
 * band is shaped, Live switches to the Chorus Patch, and Plugin Analysis sweeps
 * a response. Every window derives its state from the same loop time.
 */
export const LOOP = 14
export const REST_TIME = 10.6

export interface Rect {
  x: number
  y: number
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

/** EQ band 2 sits at this fraction of the plot width; its gain changes during the loop. */
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

/** Time when Live switches to the Chorus Patch. */
export const PATCH_AT = 8.8
export const chorusActive = (t: number): boolean => t % LOOP >= PATCH_AT

/** Plugin Analysis sweep position between 0 and 1, or -1 when idle. */
export function analysisSweep(t: number): number {
  const local = t % LOOP
  return local < 10.2 || local > 13 ? -1 : (local - 10.2) / 2.8
}
