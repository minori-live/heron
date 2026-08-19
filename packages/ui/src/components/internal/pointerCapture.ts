export function trySetPointerCapture(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId)
  } catch {
    // Synthetic browser-test events and detached previews may not own an active pointer.
  }
}
