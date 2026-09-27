import { describe, expect, it, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { nextTick } from "vue"

import UiRotaryControl from "./UiRotaryControl.vue"

function pointer(
  type: string,
  options: { clientY: number; pointerId?: number; button?: number; shiftKey?: boolean } = {
    clientY: 0
  }
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: options.clientY,
    pointerId: options.pointerId ?? 1,
    button: options.button ?? 0,
    shiftKey: options.shiftKey ?? false
  })
}

describe("UiRotaryControl", () => {
  it("previews a vertical drag and commits exactly once on release", async () => {
    const wrapper = mount(UiRotaryControl, {
      attachTo: document.body,
      props: {
        value: 0,
        min: -10,
        max: 10,
        step: 1,
        defaultValue: 0,
        dragRangePixels: 40,
        label: "Pan"
      }
    })
    const input = wrapper.get('input[type="range"]')
    ;(input.element as HTMLInputElement).setPointerCapture = vi.fn()
    ;(input.element as HTMLInputElement).releasePointerCapture = vi.fn()

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    expect(document.activeElement).toBe(input.element)
    input.element.dispatchEvent(pointer("pointermove", { clientY: 90 }))
    expect(wrapper.emitted("preview")?.at(-1)).toEqual([5])
    expect(wrapper.emitted("commit")).toBeUndefined()

    input.element.dispatchEvent(pointer("pointerup", { clientY: 90 }))
    expect(wrapper.emitted("commit")).toEqual([[5]])
    wrapper.unmount()
  })

  it("keeps the released value visible until the parent settles a commit", async () => {
    const wrapper = mount(UiRotaryControl, {
      props: {
        value: 0,
        min: -64,
        max: 63,
        step: 1,
        defaultValue: 0,
        dragRangePixels: 254,
        label: "Pan",
        awaitCommit: true
      }
    })
    const input = wrapper.get('input[type="range"]')
    ;(input.element as HTMLInputElement).setPointerCapture = vi.fn()
    ;(input.element as HTMLInputElement).releasePointerCapture = vi.fn()

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointermove", { clientY: 80 }))
    input.element.dispatchEvent(pointer("pointerup", { clientY: 80 }))
    await nextTick()
    expect(wrapper.emitted("commit")?.at(-1)?.[0]).toBe(10)
    expect(input.attributes("aria-valuetext")).toBe("10")
    expect((input.element as HTMLInputElement).value).toBe("10")

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointerup", { clientY: 100 }))
    await nextTick()
    expect(wrapper.emitted("commit")).toHaveLength(1)
    expect(input.attributes("aria-valuetext")).toBe("10")

    const settle = wrapper.emitted("commit")?.at(-1)?.[1] as () => void
    await wrapper.setProps({ value: 10 })
    settle()
    await nextTick()
    await nextTick()
    expect(input.attributes("aria-valuetext")).toBe("10")

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointermove", { clientY: 120 }))
    input.element.dispatchEvent(pointer("pointerup", { clientY: 120 }))
    await nextTick()
    expect(input.attributes("aria-valuetext")).toBe("0")
    const rejected = wrapper.emitted("commit")?.at(-1)?.[1] as () => void
    rejected()
    await nextTick()
    await nextTick()
    expect(input.attributes("aria-valuetext")).toBe("10")

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointermove", { clientY: 80 }))
    input.element.dispatchEvent(pointer("pointerup", { clientY: 80 }))
    const earlierCommit = wrapper.emitted("commit")?.at(-1)?.[1] as () => void
    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointermove", { clientY: 80 }))
    input.element.dispatchEvent(pointer("pointerup", { clientY: 80 }))
    earlierCommit()
    await nextTick()
    await nextTick()
    expect(input.attributes("aria-valuetext")).toBe("30")
    const latestCommit = wrapper.emitted("commit")?.at(-1)?.[1] as () => void
    await wrapper.setProps({ value: 30 })
    latestCommit()
    await nextTick()
    await nextTick()
    expect(input.attributes("aria-valuetext")).toBe("30")
  })

  it("does not submit a value when a click releases without changing it", () => {
    const wrapper = mount(UiRotaryControl, {
      props: {
        value: 0,
        min: -64,
        max: 63,
        step: 1,
        defaultValue: 0,
        label: "Pan",
        awaitCommit: true
      }
    })
    const input = wrapper.get('input[type="range"]')
    ;(input.element as HTMLInputElement).setPointerCapture = vi.fn()
    ;(input.element as HTMLInputElement).releasePointerCapture = vi.fn()

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointerup", { clientY: 100 }))
    expect(wrapper.emitted("commit")).toBeUndefined()
  })

  it("keeps a settled commit from changing an active pointer gesture", async () => {
    const wrapper = mount(UiRotaryControl, {
      props: {
        value: 0,
        min: -64,
        max: 63,
        step: 1,
        defaultValue: 0,
        dragRangePixels: 254,
        label: "Pan",
        awaitCommit: true
      }
    })
    const input = wrapper.get('input[type="range"]')
    ;(input.element as HTMLInputElement).setPointerCapture = vi.fn()
    ;(input.element as HTMLInputElement).releasePointerCapture = vi.fn()

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointermove", { clientY: 80 }))
    input.element.dispatchEvent(pointer("pointerup", { clientY: 80 }))
    await nextTick()
    expect(input.attributes("aria-valuetext")).toBe("10")

    const settle = wrapper.emitted("commit")?.[0]?.[1] as () => void
    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    settle() // The parent rejected the earlier edit and kept value at zero.
    await nextTick()
    await nextTick()
    expect(input.attributes("aria-valuetext")).toBe("10")

    input.element.dispatchEvent(pointer("pointerup", { clientY: 100 }))
    await nextTick()
    expect(wrapper.emitted("commit")).toHaveLength(1)
    expect(input.attributes("aria-valuetext")).toBe("0")
    wrapper.unmount()
  })

  it("scales fractional parameters by their full range instead of their step count", () => {
    const wrapper = mount(UiRotaryControl, {
      props: {
        value: -12,
        min: -90,
        max: 12,
        step: 0.1,
        defaultValue: -90,
        dragRangePixels: 180,
        label: "Reverb send level"
      }
    })
    const input = wrapper.get('input[type="range"]')
    ;(input.element as HTMLInputElement).setPointerCapture = vi.fn()

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointermove", { clientY: 82 }))
    expect(wrapper.emitted("preview")?.at(-1)).toEqual([-1.8])
  })

  it("restores the start value on cancellation and resets on double-click", async () => {
    const wrapper = mount(UiRotaryControl, {
      props: {
        value: -6,
        min: -90,
        max: 12,
        step: 0.1,
        defaultValue: -90,
        label: "Reverb send level"
      }
    })
    const input = wrapper.get('input[type="range"]')
    ;(input.element as HTMLInputElement).setPointerCapture = vi.fn()
    ;(input.element as HTMLInputElement).releasePointerCapture = vi.fn()

    input.element.dispatchEvent(pointer("pointerdown", { clientY: 100 }))
    input.element.dispatchEvent(pointer("pointermove", { clientY: 80 }))
    input.element.dispatchEvent(pointer("pointercancel", { clientY: 80 }))
    expect(wrapper.emitted("preview")?.at(-1)).toEqual([-6])
    expect(wrapper.emitted("commit")).toBeUndefined()

    await input.trigger("dblclick")
    expect(wrapper.emitted("commit")?.at(-1)).toEqual([-90])
  })

  it("supports keyboard adjustment and direct numeric editing", async () => {
    const wrapper = mount(UiRotaryControl, {
      props: {
        value: 0,
        min: -64,
        max: 63,
        step: 1,
        defaultValue: 0,
        label: "Vocal pan",
        valueLabel: "Vocal pan value",
        valueText: (value) => (value === 0 ? "Center" : String(value))
      }
    })
    const range = wrapper.get('input[type="range"]')
    expect(range.attributes("aria-valuetext")).toBe("Center")
    ;(range.element as HTMLInputElement).value = "12"
    await range.trigger("input")
    expect(wrapper.emitted("preview")?.at(-1)).toEqual([12])
    expect(range.attributes("aria-valuetext")).toBe("12")
    expect((range.element as HTMLInputElement).value).toBe("12")

    // A controlled parent still exposes the pre-gesture prop until its async commit completes.
    ;(range.element as HTMLInputElement).value = "0"
    await range.trigger("change")
    expect(wrapper.emitted("commit")?.at(-1)).toEqual([12])

    await range.trigger("keydown", { key: "F2" })
    const editor = wrapper.get('input[aria-label="Vocal pan value"]')
    await editor.setValue("-32")
    await editor.trigger("keydown", { key: "Enter" })
    expect(wrapper.emitted("commit")?.at(-1)).toEqual([-32])
  })

  it("restores a keyboard gesture with Escape without committing", async () => {
    const wrapper = mount(UiRotaryControl, {
      props: {
        value: 0,
        min: -64,
        max: 63,
        step: 1,
        defaultValue: 0,
        label: "Vocal pan"
      }
    })
    const range = wrapper.get('input[type="range"]')
    ;(range.element as HTMLInputElement).value = "24"
    await range.trigger("input")
    await range.trigger("keydown", { key: "Escape" })
    await range.trigger("change")

    expect(wrapper.emitted("preview")?.at(-1)).toEqual([0])
    expect(wrapper.emitted("commit")).toBeUndefined()
    expect((range.element as HTMLInputElement).value).toBe("0")
  })
})
