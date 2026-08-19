import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"

import type { UiGestureIntent } from "../types"

import UiAutomationLane from "./UiAutomationLane.vue"
import UiDropZone from "./UiDropZone.vue"
import UiPianoRollViewport from "./UiPianoRollViewport.vue"
import UiResizeHandle from "./UiResizeHandle.vue"
import UiTimelineClip from "./UiTimelineClip.vue"
import UiGestureSurface from "./internal/UiGestureSurface.vue"

function pointer(
  type: string,
  options: { clientX?: number; clientY?: number; pointerId?: number; button?: number } = {}
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    pointerId: options.pointerId ?? 1
  })
}

function drag(type: string, dataTransfer: Partial<DataTransfer>): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  return event
}

describe("Storybook interaction boundary components", () => {
  it("does not capture gestures that belong to interactive descendants", () => {
    const wrapper = mount(UiGestureSurface, {
      props: { label: "Track surface" },
      slots: { default: '<button type="button">Clip</button><i class="grid-line" />' }
    })
    const surface = wrapper.element as HTMLElement
    surface.setPointerCapture = vi.fn()

    wrapper.get("button").element.dispatchEvent(pointer("pointerdown", { clientX: 12 }))
    wrapper.get("button").element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    expect(wrapper.emitted("gesture")).toBeUndefined()
    expect(wrapper.emitted("doubleActivate")).toBeUndefined()

    wrapper.get(".grid-line").element.dispatchEvent(pointer("pointerdown", { clientX: 20 }))
    expect(wrapper.emitted("gesture")?.[0]?.[0]).toMatchObject({ phase: "start" })
  })

  it("normalizes resize pointer phases and keyboard equivalents", async () => {
    const wrapper = mount(UiResizeHandle, {
      props: {
        axis: "horizontal",
        label: "Resize inspector",
        value: 320,
        minimum: 240,
        maximum: 600,
        keyboardStep: 8,
        resetOnDoubleClick: true
      }
    })
    const handle = wrapper.get('[role="separator"]')
    ;(handle.element as HTMLElement).setPointerCapture = vi.fn()

    handle.element.dispatchEvent(pointer("pointerdown", { clientX: 10 }))
    handle.element.dispatchEvent(pointer("pointermove", { clientX: 24 }))
    handle.element.dispatchEvent(pointer("pointercancel", { clientX: 24 }))

    const resizeGestures = wrapper.emitted("gesture") as [UiGestureIntent][]
    expect(resizeGestures.map(([intent]) => intent.phase)).toEqual(["start", "update", "cancel"])
    expect(resizeGestures[1]?.[0].delta).toEqual({ x: 14, y: 0 })
    expect(handle.attributes()).toMatchObject({
      "aria-valuenow": "320",
      "aria-valuemin": "240",
      "aria-valuemax": "600"
    })

    await handle.trigger("keydown", { key: "ArrowLeft" })
    expect(wrapper.emitted("gesture")?.at(-1)?.[0]).toMatchObject({
      phase: "commit",
      delta: { x: -8, y: 0 }
    })
    await handle.trigger("keydown", { key: "Home" })
    await handle.trigger("dblclick")
    expect(wrapper.emitted("reset")).toHaveLength(2)
  })

  it("encapsulates drag payload extraction and cancellation visuals", async () => {
    const values = new Map([["application/x-heron-clip", "clip-7"]])
    const transfer = {
      types: [...values.keys()],
      dropEffect: "none",
      getData: (mime: string) => values.get(mime) ?? ""
    } as Partial<DataTransfer>
    const wrapper = mount(UiDropZone, {
      props: { label: "Arrangement drop target", mimeTypes: [...values.keys()] }
    })

    wrapper.element.dispatchEvent(drag("dragover", transfer))
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain("ui-drop-zone--active")
    expect(transfer.dropEffect).toBe("copy")

    window.dispatchEvent(new Event("dragend"))
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain("ui-drop-zone--active")

    wrapper.element.dispatchEvent(drag("drop", transfer))
    expect(wrapper.emitted("drop")).toEqual([
      [[{ mime: "application/x-heron-clip", value: "clip-7" }]]
    ])
  })

  it("exposes clip selection, editing phases, ARIA values, and keyboard removal", async () => {
    const wrapper = mount(UiTimelineClip, {
      props: {
        model: { id: "clip-1", label: "Verse", start: 12, width: 80, selected: true },
        kind: "audio",
        label: "Verse clip",
        openLabel: "Open Verse",
        trimStartLabel: "Trim start",
        fadeInLabel: "Fade in",
        fadeInValue: 24,
        fadeInMaximum: 120
      }
    })
    const trim = wrapper.get('[aria-label="Trim start"]')
    ;(trim.element as HTMLElement).setPointerCapture = vi.fn()
    trim.element.dispatchEvent(pointer("pointerdown", { clientX: 20 }))
    trim.element.dispatchEvent(pointer("pointermove", { clientX: 27 }))
    trim.element.dispatchEvent(pointer("pointerup", { clientX: 27 }))

    const clipGestures = wrapper.emitted("gesture") as [string, UiGestureIntent][]
    expect(clipGestures.map(([action, intent]) => [action, intent.phase])).toEqual([
      ["trim-start", "start"],
      ["trim-start", "update"],
      ["trim-start", "commit"]
    ])
    expect(wrapper.get('[aria-label="Fade in"]').attributes()).toMatchObject({
      "aria-valuenow": "24",
      "aria-valuemax": "120"
    })

    await wrapper.trigger("click", { ctrlKey: true })
    await wrapper.trigger("keydown", { key: "Delete" })
    await wrapper.trigger("keydown", { key: "Enter" })
    expect(wrapper.emitted("select")).toEqual([[true]])
    expect(wrapper.emitted("remove")).toHaveLength(1)
    expect(wrapper.emitted("open")).toHaveLength(1)
  })

  it("keeps automation point gestures and lane creation DOM-free at its public API", async () => {
    const wrapper = mount(UiAutomationLane, {
      props: {
        mode: "value",
        label: "Volume automation",
        width: 400,
        height: 100,
        points: [{ id: "point-1", x: 40, y: 25, label: "Point 1", selected: true }]
      }
    })
    const lane = wrapper.get('[aria-label="Volume automation"]')
    ;(lane.element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 400, height: 100 }) as DOMRect

    await lane.trigger("dblclick", { clientX: 70, clientY: 55 })
    await wrapper.get('[aria-label="Point 1"]').trigger("keydown", { key: "Delete" })
    expect(wrapper.emitted("create")).toEqual([[{ x: 60, y: 35 }]])
    expect(wrapper.emitted("remove")).toEqual([["point-1"]])
  })

  it("normalizes viewport, keyboard, focus, and zoom wheel intents", async () => {
    const wrapper = mount(UiPianoRollViewport, {
      attachTo: document.body,
      props: { label: "Piano roll" }
    })
    const viewport = wrapper.get('[aria-label="Piano roll"]')
    ;(viewport.element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 20, top: 30, width: 640, height: 320 }) as DOMRect

    await viewport.trigger("focusin")
    await viewport.trigger("keydown", { key: "ArrowRight", code: "ArrowRight", shiftKey: true })
    await viewport.trigger("wheel", {
      clientX: 100,
      clientY: 90,
      deltaX: 2,
      deltaY: -24,
      ctrlKey: true
    })

    expect(wrapper.emitted("viewport")?.[0]?.[0]).toMatchObject({ scrollLeft: 0, scrollTop: 0 })
    expect(wrapper.emitted("focusChange")).toEqual([[true]])
    expect(wrapper.emitted("keyboard")?.[0]?.[0]).toMatchObject({
      key: "ArrowRight",
      code: "ArrowRight",
      modifiers: { shift: true }
    })
    expect(wrapper.emitted("wheel")?.[0]?.[0]).toMatchObject({
      point: { x: 80, y: 60 },
      delta: { x: 2, y: -24 },
      modifiers: { control: true }
    })
    wrapper.unmount()
  })
})
