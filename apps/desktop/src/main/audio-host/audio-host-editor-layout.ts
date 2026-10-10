export interface EditorBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface NativeEditorLayout {
  width: number
  height: number
  topInset: number
  displayScale: number
}

interface BoundsAcknowledgement {
  requested: EditorBounds
  observed?: EditorBounds
}

export interface EditorLayoutState {
  native?: NativeEditorLayout
  nativeHandle?: string
  displayScale?: number
  toolbar?: BoundsAcknowledgement
  view?: BoundsAcknowledgement
  content?: {
    requested: [number, number]
    observed: [number, number]
    displayScale: number
  }
}

export function sameBounds(a: EditorBounds | undefined, b: EditorBounds): boolean {
  return a?.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function sameNativeLayout(
  a: NativeEditorLayout | undefined,
  b: NativeEditorLayout
): boolean {
  return (
    a?.width === b.width &&
    a.height === b.height &&
    a.topInset === b.topInset &&
    a.displayScale === b.displayScale
  )
}

export function applyEditorBounds(
  previous: BoundsAcknowledgement | undefined,
  requested: EditorBounds,
  target: { setBounds(bounds: EditorBounds): void; getBounds?(): EditorBounds }
): BoundsAcknowledgement {
  const observed = target.getBounds?.()
  if (
    sameBounds(previous?.requested, requested) &&
    (!observed || sameBounds(previous?.observed, observed))
  ) {
    return previous!
  }
  target.setBounds(requested)
  // Electron can report an extra integer DIP after converting the native frame.
  // Remember that readback rather than repeatedly retrying the requested bounds.
  return { requested, observed: target.getBounds?.() }
}

export function settledContentSize(
  state: EditorLayoutState,
  actual: [number, number],
  displayScale: number
): [number, number] {
  const content = state.content
  if (
    content?.displayScale === displayScale &&
    content.observed[0] === actual[0] &&
    content.observed[1] === actual[1]
  ) {
    return content.requested
  }
  state.content = undefined
  return actual
}

export function acknowledgeContentSize(
  state: EditorLayoutState,
  requested: [number, number],
  observed: [number, number],
  displayScale: number
): void {
  // This only acknowledges the immediate readback of our own size request.
  // A later external resize clears it. Integer-DIP conversion can differ by one
  // DIP, so comparing repeatedly rounded snapshots would otherwise grow a window.
  state.content =
    Math.abs(requested[0] - observed[0]) <= 1 && Math.abs(requested[1] - observed[1]) <= 1
      ? { requested, observed, displayScale }
      : undefined
}

export function equivalentContentSize(
  actual: [number, number],
  requested: [number, number],
  displayScale: number,
  platform: NodeJS.Platform = process.platform
): boolean {
  const scale = platform === "darwin" ? 1 : Math.max(0.01, displayScale)
  return actual.every(
    (value, index) => Math.round(value * scale) === Math.round(requested[index]! * scale)
  )
}

function nativeDimension(value: number, scaleFactor: number, platform: NodeJS.Platform): number {
  const scale = platform === "darwin" ? 1 : Math.max(0.01, scaleFactor)
  return Math.max(1, Math.round(value * scale))
}

export function nativeParentTopInset(
  window: { getBounds(): EditorBounds; getContentBounds(): EditorBounds },
  toolbarHeight: number,
  scaleFactor: number,
  platform: NodeJS.Platform = process.platform
): number {
  const windowBounds = window.getBounds()
  const contentBounds = window.getContentBounds()
  const nativeChromeHeight =
    platform === "linux" ? Math.max(0, contentBounds.y - windowBounds.y) : 0
  return nativeDimension(toolbarHeight + nativeChromeHeight, scaleFactor, platform)
}

export function nativeExtent(
  width: number,
  height: number,
  scaleFactor: number,
  platform: NodeJS.Platform = process.platform
): { width: number; height: number } {
  return {
    width: nativeDimension(width, scaleFactor, platform),
    height: nativeDimension(height, scaleFactor, platform)
  }
}
