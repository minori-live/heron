import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import type { UiGestureIntent } from "../types"

import UiDraggableItem from "./UiDraggableItem.vue"
import UiDropZone from "./UiDropZone.vue"
import UiTimelineClip from "./UiTimelineClip.vue"

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

function transfer() {
  const data = new Map<string, string>()
  return {
    get types() {
      return [...data.keys()]
    },
    effectAllowed: "none",
    dropEffect: "none",
    setData: vi.fn((mime: string, value: string) => data.set(mime, value)),
    getData: (mime: string) => data.get(mime) ?? "",
    setDragImage: vi.fn()
  }
}

function drag(
  element: Element,
  type: string,
  dataTransfer: ReturnType<typeof transfer> | null,
  clientX = 30
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX })
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
      clientX: 20,
      clientY: 30,
      ...init
    })
  )
}

describe("media and clip drag contracts", () => {
  it("serializes drag data and supports keyboard reorder without exposing DataTransfer", async () => {
    const item = mount(UiDraggableItem, {
      props: {
        label: "Bass.wav",
        data: [
          { mime: "application/x-media", value: "asset-1" },
          { mime: "text/plain", value: "Bass.wav" }
        ]
      }
    })
    const data = transfer()
    expect(drag(item.element, "dragstart", data).defaultPrevented).toBe(false)
    expect(data.effectAllowed).toBe("copyMove")
    expect(data.setData.mock.calls).toEqual([
      ["application/x-media", "asset-1"],
      ["text/plain", "Bass.wav"]
    ])
    drag(item.element, "dragend", data)
    expect(item.emitted("dragStart")).toEqual([[]])
    expect(item.emitted("dragEnd")).toEqual([[]])
    await item.trigger("keydown", { key: "ArrowUp" })
    expect(item.emitted("reorder")).toBeUndefined()
    await item.trigger("keydown", { key: "ArrowUp", altKey: true })
    await item.trigger("keydown", { key: "ArrowDown", altKey: true })
    expect(item.emitted("reorder")).toEqual([[-1], [1]])
    expect(drag(item.element, "dragstart", null).defaultPrevented).toBe(true)
    await item.setProps({ disabled: true })
    expect(item.attributes("draggable")).toBe("false")
    expect(item.attributes("tabindex")).toBeUndefined()
    expect(drag(item.element, "dragstart", data).defaultPrevented).toBe(true)
    await item.trigger("keydown", { key: "ArrowUp", altKey: true })
    expect(item.emitted("reorder")).toHaveLength(2)
    expect(item.emitted("dragStart")).toHaveLength(1)
  })

  it("rejects unsupported/disabled drops and clears highlight only when the target is left", async () => {
    const zone = mount(UiDropZone, {
      props: { label: "Import", mimeTypes: ["application/x-media", "application/x-empty"] },
      slots: { default: "<span>Drop here</span>" }
    })
    const data = transfer()
    data.setData("text/plain", "unrelated")
    drag(zone.element, "dragover", data)
    drag(zone.element, "drop", null)
    expect(zone.emitted("drop")).toBeUndefined()
    data.setData("application/x-media", "asset-1")
    drag(zone.element, "dragenter", data)
    await nextTick()
    expect(zone.classes()).toContain("ui-drop-zone--active")
    drag(zone.get("span").element, "dragleave", data)
    await nextTick()
    expect(zone.classes()).toContain("ui-drop-zone--active")
    drag(zone.element, "dragleave", data)
    await nextTick()
    expect(zone.classes()).not.toContain("ui-drop-zone--active")
    drag(zone.element, "drop", data)
    expect(zone.emitted("drop")).toEqual([[[{ mime: "application/x-media", value: "asset-1" }]]])
    await zone.setProps({ disabled: true })
    drag(zone.element, "dragover", data)
    drag(zone.element, "drop", data)
    expect(zone.emitted("drop")).toHaveLength(1)
  })

  const props = {
    model: { id: "clip-1", label: "Bass", start: 10, width: 100, selected: true },
    kind: "audio" as const,
    label: "Bass clip",
    openLabel: "Open Bass",
    trimStartLabel: "Trim start",
    trimEndLabel: "Trim end",
    fadeInLabel: "Fade in",
    fadeOutLabel: "Fade out",
    dragData: [{ mime: "application/x-clip", value: "clip-1" }]
  }

  it.each([
    ["Trim start", "trim-start"],
    ["Trim end", "trim-end"],
    ["Fade in", "fade-in"],
    ["Fade out", "fade-out"]
  ])("previews, commits and cancels %s exactly once", async (label, action) => {
    const clip = mount(UiTimelineClip, { props })
    const handle = clip.get(`[aria-label="${label}"]`)
    pointer(handle.element, "pointermove")
    pointer(handle.element, "pointerup")
    pointer(handle.element, "pointercancel")
    pointer(handle.element, "pointerdown", { button: 2 })
    expect(clip.emitted("gesture")).toBeUndefined()
    pointer(handle.element, "pointerdown")
    pointer(handle.element, "pointerdown", { pointerId: 2 })
    pointer(handle.element, "pointermove", { pointerId: 2 })
    pointer(handle.element, "pointermove", { clientX: 45, shiftKey: true })
    pointer(handle.element, "pointerup", { clientX: 45 })
    expect(
      clip
        .emitted<[string, UiGestureIntent]>("gesture")
        ?.map(([mode, intent]) => [mode, intent.phase])
    ).toEqual([
      [action, "start"],
      [action, "update"],
      [action, "commit"]
    ])
    expect(clip.emitted("gesture")?.[1]?.[1]).toMatchObject({
      delta: { x: 25, y: 0 },
      modifiers: { shift: true }
    })
    pointer(handle.element, "pointerdown")
    pointer(handle.element, "lostpointercapture")
    expect(clip.emitted<[string, UiGestureIntent]>("gesture")?.at(-1)?.[1].phase).toBe("cancel")
    pointer(handle.element, "pointerdown")
    await clip.trigger("keydown", { key: "Escape" })
    pointer(handle.element, "pointerup")
    expect(clip.emitted("gesture")?.at(-1)?.[1]).toMatchObject({
      phase: "cancel",
      delta: { x: 0, y: 0 }
    })
  })

  it("sets clip drag payload and clamps the grab offset to the visible clip", async () => {
    const clip = mount(UiTimelineClip, { props })
    vi.spyOn(clip.element, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 0, 100, 30))
    const data = transfer()
    for (const x of [5, 40, 150]) drag(clip.element, "dragstart", data, x)
    expect(clip.emitted("dragStart")).toEqual([[0], [30], [100]])
    expect(data.effectAllowed).toBe("move")
    expect(data.setData).toHaveBeenCalledWith("application/x-clip", "clip-1")
    expect(data.setDragImage).toHaveBeenCalledWith(expect.any(HTMLElement), 0, 0)
    drag(clip.element, "dragend", data)
    expect(clip.emitted("dragEnd")).toEqual([[]])
    expect(drag(clip.element, "dragstart", null).defaultPrevented).toBe(true)
    await clip.setProps({ editing: true })
    expect(drag(clip.element, "dragstart", data).defaultPrevented).toBe(true)
    await clip.setProps({ editing: false })
    pointer(clip.get('[aria-label="Trim start"]').element, "pointerdown")
    expect(drag(clip.element, "dragstart", data).defaultPrevented).toBe(true)
    await clip.trigger("keydown", { key: "Escape" })
    await clip.trigger("dblclick")
    expect(clip.emitted("open")).toEqual([[]])
  })

  it.each(["recording", "disabled"])("does not edit or drag a %s clip", async (state) => {
    const clip = mount(UiTimelineClip, {
      props: {
        ...props,
        recording: state === "recording",
        model: { ...props.model, disabled: state === "disabled" }
      }
    })
    pointer(clip.get('[aria-label="Trim start"]').element, "pointerdown")
    await clip.trigger("keydown", { key: "Delete" })
    await clip.trigger("keydown", { key: "Enter" })
    expect(drag(clip.element, "dragstart", transfer()).defaultPrevented).toBe(true)
    expect(clip.emitted("gesture")).toBeUndefined()
    expect(clip.emitted("remove")).toBeUndefined()
    expect(clip.emitted("open")).toBeUndefined()
    expect(clip.attributes("draggable")).toBe("false")
  })
})
