import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { UiGestureIntent } from "../types"
import UiArrangementViewport from "./UiArrangementViewport.vue"
import UiPianoRollViewport from "./UiPianoRollViewport.vue"
import UiResizeHandle from "./UiResizeHandle.vue"

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function observeResize() {
  let notify = () => {}
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback
      }
      observe = observe
      disconnect = disconnect
    }
  )
  return { resize: () => notify(), observe, disconnect }
}

function measure(element: Element) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 600, 300))
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 300 }
  })
}

function wheel(element: Element, init: WheelEventInit = {}) {
  // happy-dom's WheelEvent extends UIEvent and drops MouseEvent coordinates/modifiers.
  const event = new MouseEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 80,
    ...init
  })
  Object.defineProperties(event, {
    deltaX: { value: init.deltaX ?? 2 },
    deltaY: { value: init.deltaY ?? -10 }
  })
  element.dispatchEvent(event)
  return event
}

function drop(element: Element, type: string, dataTransfer: object | null) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 80
  })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  element.dispatchEvent(event)
  return event
}

function pointer(element: Element, type: string, init: PointerEventInit = {}) {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      clientX: 30,
      clientY: 40,
      ...init
    })
  )
}

describe("editor viewport contracts", () => {
  it("measures the arrangement rail, synchronizes scrolling, and normalizes modified wheel intents", async () => {
    const observer = observeResize()
    const view = mount(UiArrangementViewport, {
      props: { label: "Arrangement", scrollLeft: 40, railWidth: 20 },
      slots: { default: "<aside data-ui-arrangement-rail>Tracks</aside>" }
    })
    measure(view.element)
    Object.defineProperty(view.get("aside").element, "offsetWidth", { value: 80 })
    view.element.scrollTop = 12
    observer.resize()
    expect(view.emitted("viewport")?.at(-1)).toEqual([
      { scrollLeft: 40, scrollTop: 12, width: 520, height: 300 }
    ])
    expect(observer.observe.mock.calls).toEqual([[view.element], [view.get("aside").element]])
    await view.setProps({ scrollLeft: 70 })
    expect(view.element.scrollLeft).toBe(70)
    await view.trigger("scroll")
    expect(view.emitted("viewport")?.at(-1)?.[0]).toMatchObject({ scrollLeft: 70 })
    expect(wheel(view.element).defaultPrevented).toBe(false)
    expect(view.emitted("wheel")).toBeUndefined()
    for (const key of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(wheel(view.element, { [key]: true }).defaultPrevented).toBe(true)
    }
    expect(view.emitted("wheel")).toHaveLength(4)
    expect(view.emitted("wheel")?.at(-1)).toEqual([
      {
        point: { x: 80, y: 72 },
        delta: { x: 2, y: -10 },
        modifiers: { alt: false, control: false, meta: false, shift: true }
      }
    ])
    view.unmount()
    expect(observer.disconnect).toHaveBeenCalledOnce()
  })

  it("previews accepted MIME types, resolves file drops, and rejects unrelated payloads", async () => {
    const resolveFiles = vi.fn(() => ["/audio/Bass.wav"])
    const view = mount(UiArrangementViewport, {
      props: {
        label: "Arrangement",
        railWidth: 20,
        mimeTypes: ["application/x-clip", "application/x-empty"],
        acceptFiles: true,
        resolveFiles
      },
      slots: { default: '<section data-track-id="t1" data-track-kind="audio">Track</section>' }
    })
    measure(view.element)
    const track = view.get("section").element
    expect(drop(track, "dragover", null).defaultPrevented).toBe(false)
    expect(drop(track, "drop", { types: ["text/plain"], files: [] }).defaultPrevented).toBe(false)
    expect(view.emitted("drop")).toBeUndefined()
    const data = {
      types: ["application/x-clip"],
      files: [],
      effectAllowed: "move",
      dropEffect: "none",
      getData: vi.fn((mime: string) => (mime === "application/x-clip" ? "clip-1" : ""))
    }
    expect(drop(track, "dragover", data).defaultPrevented).toBe(true)
    expect(data.dropEffect).toBe("move")
    expect(data.getData).not.toHaveBeenCalled()
    expect(view.emitted("dragMove")).toEqual([
      [
        {
          point: { x: 70, y: 60 },
          targetId: "t1",
          targetKind: "audio",
          data: [{ mime: "application/x-clip", value: "" }]
        }
      ]
    ])
    await view.setProps({ acceptFiles: false })
    drop(track, "drop", data)
    expect(resolveFiles).not.toHaveBeenCalled()
    expect(view.emitted("drop")?.at(-1)?.[0]).toMatchObject({
      data: [{ mime: "application/x-clip", value: "clip-1" }]
    })
    await view.setProps({ acceptFiles: true })
    const file = new File(["audio"], "Bass.wav")
    const files = {
      ...data,
      types: ["Files"],
      files: [file],
      effectAllowed: "copy",
      getData: () => ""
    }
    drop(view.element, "dragover", files)
    expect(files.dropEffect).toBe("copy")
    expect(drop(view.element, "drop", files).defaultPrevented).toBe(true)
    expect(resolveFiles).toHaveBeenCalledWith([file])
    expect(view.emitted("drop")?.at(-1)).toEqual([
      {
        point: { x: 70, y: 60 },
        targetId: undefined,
        targetKind: undefined,
        data: [{ mime: "application/x-heron-file-path", value: "/audio/Bass.wav" }]
      }
    ])
    // Some hosts expose files without a Files entry in types.
    expect(drop(view.element, "drop", { ...files, types: [] }).defaultPrevented).toBe(true)
    await view.setProps({ resolveFiles: undefined })
    drop(view.element, "drop", files)
    expect(view.emitted("drop")?.at(-1)?.[0]).toMatchObject({ data: [] })
  })

  it("keeps piano scrolling controlled without swallowing text editing or ordinary scrolling", async () => {
    const observer = observeResize()
    const view = mount(UiPianoRollViewport, {
      props: { label: "Piano roll" },
      slots: { default: '<input aria-label="Name" /><textarea aria-label="Notes"></textarea>' }
    })
    measure(view.element)
    await view.setProps({ scrollLeft: 100, scrollTop: 50 })
    observer.resize()
    expect(view.emitted("viewport")?.at(-1)).toEqual([
      { scrollLeft: 100, scrollTop: 50, width: 600, height: 300 }
    ])
    await view.setProps({ scrollLeft: undefined, scrollTop: 70 })
    await view.setProps({ scrollTop: undefined })
    await view.trigger("scroll")
    expect(view.emitted("viewport")?.at(-1)?.[0]).toMatchObject({ scrollLeft: 100, scrollTop: 70 })
    for (const tag of ["input", "textarea"])
      await view.get(tag).trigger("keydown", { key: "Delete" })
    expect(view.emitted("keyboard")).toBeUndefined()
    await view.trigger("keydown", { key: "Delete", code: "Delete", repeat: true, shiftKey: true })
    expect(view.emitted("keyboard")).toEqual([
      [
        {
          key: "Delete",
          code: "Delete",
          repeat: true,
          modifiers: { alt: false, control: false, meta: false, shift: true }
        }
      ]
    ])
    expect(wheel(view.element).defaultPrevented).toBe(false)
    expect(view.emitted("wheel")).toBeUndefined()
    for (const key of ["ctrlKey", "metaKey"] as const)
      expect(wheel(view.element, { [key]: true }).defaultPrevented).toBe(true)
    expect(view.emitted("wheel")?.at(-1)).toEqual([
      {
        point: { x: 90, y: 60 },
        delta: { x: 2, y: -10 },
        modifiers: { alt: false, control: false, meta: true, shift: false }
      }
    ])
    await view.trigger("focusin")
    await view.trigger("focusout")
    expect(view.emitted("focusChange")).toEqual([[true], [false]])
    view.unmount()
    expect(observer.disconnect).toHaveBeenCalledOnce()
  })
})

describe("resize handle contracts", () => {
  it.each(["pointerup", "pointercancel", "lostpointercapture", "Escape"])(
    "finishes with %s, releases capture, and ignores unrelated pointers",
    async (end) => {
      const handle = mount(UiResizeHandle, {
        attachTo: document.body,
        props: { axis: "horizontal", label: "Track width" }
      })
      const target = handle.element as HTMLElement
      target.setPointerCapture = vi.fn()
      target.hasPointerCapture = vi.fn(() => true)
      target.releasePointerCapture = vi.fn()
      pointer(target, "pointermove")
      pointer(target, "pointerup")
      pointer(target, "pointercancel")
      pointer(target, "pointerdown", { button: 2 })
      expect(handle.emitted("gesture")).toBeUndefined()
      pointer(target, "pointerdown")
      expect(document.activeElement).toBe(target)
      expect(target.setPointerCapture).toHaveBeenCalledWith(1)
      pointer(target, "pointerdown", { pointerId: 2 })
      pointer(target, "pointermove", { pointerId: 2 })
      pointer(target, "pointercancel", { pointerId: 2 })
      await handle.trigger("keydown", { key: "ArrowRight" })
      expect(handle.emitted("gesture")).toHaveLength(1)
      pointer(target, "pointermove", { clientX: 60, shiftKey: true })
      if (end === "Escape") await handle.trigger("keydown", { key: "Escape" })
      else pointer(target, end, { clientX: 60, shiftKey: true })
      pointer(target, "pointerup")
      expect(handle.emitted<[UiGestureIntent]>("gesture")?.map(([intent]) => intent.phase)).toEqual(
        ["start", "update", end === "pointerup" ? "commit" : "cancel"]
      )
      expect(handle.emitted("gesture")?.at(-1)?.[0]).toMatchObject({
        delta: { x: 30, y: 0 },
        modifiers: { shift: true }
      })
      expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
    }
  )

  it.each(["horizontal", "vertical"] as const)(
    "supports %s keyboard resize, reset and disabled state",
    async (axis) => {
      const handle = mount(UiResizeHandle, {
        props: { axis, label: "Resize", keyboardStep: 7, value: 100, minimum: 20, maximum: 200 }
      })
      expect(handle.attributes()).toMatchObject({
        role: "separator",
        "aria-valuenow": "100",
        "aria-valuemin": "20",
        "aria-valuemax": "200",
        "aria-orientation": axis === "horizontal" ? "vertical" : "horizontal"
      })
      await handle.trigger("keydown", { key: "x" })
      for (const key of axis === "horizontal"
        ? ["ArrowLeft", "ArrowRight"]
        : ["ArrowUp", "ArrowDown"])
        await handle.trigger("keydown", { key })
      const commits = handle
        .emitted<[UiGestureIntent]>("gesture")
        ?.filter(([intent]) => intent.phase === "commit")
      expect(commits?.map(([intent]) => intent.delta)).toEqual(
        axis === "horizontal"
          ? [
              { x: -7, y: 0 },
              { x: 7, y: 0 }
            ]
          : [
              { x: 0, y: -7 },
              { x: 0, y: 7 }
            ]
      )
      await handle.trigger("dblclick")
      expect(handle.emitted("reset")).toBeUndefined()
      await handle.trigger("keydown", { key: "Home" })
      await handle.setProps({ resetOnDoubleClick: true })
      await handle.trigger("dblclick")
      expect(handle.emitted("reset")).toEqual([[], []])
      await handle.setProps({ disabled: true })
      expect(handle.attributes()).toMatchObject({ tabindex: "-1", "aria-disabled": "true" })
      await handle.trigger("keydown", { key: "Home" })
      await handle.trigger("dblclick")
      pointer(handle.element, "pointerdown")
      expect(handle.emitted("reset")).toHaveLength(2)
      expect(handle.emitted("gesture")).toHaveLength(4)
    }
  )
})
