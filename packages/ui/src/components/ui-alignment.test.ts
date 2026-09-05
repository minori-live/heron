import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"
import UiArrangementViewport from "./UiArrangementViewport.vue"
import UiInlineTextEdit from "./UiInlineTextEdit.vue"
import UiResizeHandle from "./UiResizeHandle.vue"
import UiGestureSurface from "./internal/UiGestureSurface.vue"
import type { UiDropIntent, UiGestureIntent } from "../types"

describe("pre-refactor interaction contracts", () => {
  it("leaves typing, deletion and navigation inside nested editors alone", async () => {
    const wrapper = mount(UiGestureSurface, {
      props: { label: "Track" },
      slots: { default: '<input aria-label="Track name" />' }
    })
    for (const key of ["Backspace", "Delete", "ArrowLeft", "Enter", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      wrapper.get("input").element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(wrapper.emitted("remove")).toBeUndefined()
    expect(wrapper.emitted("activate")).toBeUndefined()
    expect(wrapper.emitted("step")).toBeUndefined()
    await wrapper.setProps({ disabled: true })
    await wrapper.trigger("keydown", { key: "Delete" })
    expect(wrapper.emitted("remove")).toBeUndefined()
  })

  it("cancels only the initiating resize pointer and ignores its subsequent release", async () => {
    const wrapper = mount(UiResizeHandle, {
      attachTo: document.body,
      props: { axis: "vertical", label: "Track height" }
    })
    await wrapper.trigger("pointerdown", { pointerId: 2, button: 0, clientY: 100 })
    expect(document.activeElement).toBe(wrapper.element)
    await wrapper.trigger("pointermove", { pointerId: 3, clientY: 150 })
    await wrapper.trigger("pointerup", { pointerId: 3, clientY: 150 })
    expect(wrapper.emitted("gesture")).toHaveLength(1)
    await wrapper.trigger("pointermove", { pointerId: 2, clientY: 130 })
    await wrapper.trigger("keydown", { key: "Escape" })
    await wrapper.trigger("pointerup", { pointerId: 2, clientY: 130 })
    expect(wrapper.emitted<[UiGestureIntent]>("gesture")?.map(([intent]) => intent.phase)).toEqual([
      "start",
      "update",
      "cancel"
    ])
    expect(wrapper.attributes("aria-orientation")).toBe("horizontal")
    await wrapper.setProps({ disabled: true, resetOnDoubleClick: true })
    await wrapper.trigger("dblclick")
    await wrapper.trigger("keydown", { key: "Home" })
    expect(wrapper.emitted("reset")).toBeUndefined()
    wrapper.unmount()
  })

  it("keeps numeric editing string-based and restores keyboard focus after commit or cancel", async () => {
    const wrapper = mount(UiInlineTextEdit, {
      attachTo: document.body,
      props: { value: "-90", label: "Gain", inputType: "number", density: "compact" },
      slots: { default: "−∞" }
    })
    await wrapper.get("button").trigger("dblclick")
    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("-90")
    await wrapper.get("input").setValue("-3.5")
    await wrapper.get("input").trigger("keydown", { key: "Enter" })
    expect(wrapper.emitted("commit")).toEqual([["-3.5"]])
    expect(document.activeElement).toBe(wrapper.get("button").element)
    await wrapper.get("button").trigger("keydown", { key: "F2" })
    await wrapper.get("input").setValue("6")
    await wrapper.get("input").trigger("keydown", { key: "Escape" })
    expect(wrapper.emitted("commit")).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get("button").element)
    wrapper.unmount()
  })

  it("accepts OS file drags before the protected file payload becomes available", () => {
    const resolveFiles = vi.fn(() => ["/audio/take.wav"])
    const wrapper = mount(UiArrangementViewport, {
      props: { label: "Arrangement", acceptFiles: true, resolveFiles }
    })
    const transfer = { types: ["Files"], files: [], effectAllowed: "copy", dropEffect: "none" }
    const over = new Event("dragover", { bubbles: true, cancelable: true })
    Object.defineProperty(over, "dataTransfer", { value: transfer })
    wrapper.element.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect(transfer.dropEffect).toBe("copy")
    expect(resolveFiles).not.toHaveBeenCalled()
    const drop = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(drop, "dataTransfer", {
      value: { ...transfer, files: [new File([], "take.wav")] }
    })
    wrapper.element.dispatchEvent(drop)
    expect(wrapper.emitted<[UiDropIntent]>("drop")?.[0]?.[0].data).toEqual([
      { mime: "application/x-heron-file-path", value: "/audio/take.wav" }
    ])
  })
})
