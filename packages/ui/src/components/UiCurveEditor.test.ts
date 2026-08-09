import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import UiCurveEditor from "./UiCurveEditor.vue"

const curves = [
  {
    id: "line",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ]
  }
]
const handles = [
  { id: "start", label: "Start", x: 0, y: 0, minX: 0, maxX: 0 },
  { id: "middle", label: "Middle", x: 0.5, y: 0.5, minX: 0.25, maxX: 0.75 }
]

describe("UiCurveEditor", () => {
  it("moves a focused handle with coarse and fine keyboard steps", async () => {
    const wrapper = mount(UiCurveEditor, { props: { curves, handles } })
    const handle = wrapper.get('[aria-label="Middle"]')

    await handle.trigger("keydown", { key: "ArrowUp" })
    await handle.trigger("keydown", { key: "ArrowLeft", shiftKey: true })

    expect(wrapper.emitted("moveHandle")?.[0]).toEqual([{ id: "middle", x: 0.5, y: 0.51 }])
    expect(wrapper.emitted("moveHandle")?.[1]).toEqual([{ id: "middle", x: 0.499, y: 0.5 }])
    expect(handle.attributes("aria-valuetext")).toContain("Input 0.500, output 0.500")
  })

  it("converts pointer positions to normalized values and clamps handle constraints", async () => {
    const wrapper = mount(UiCurveEditor, { props: { curves, handles } })
    const canvas = wrapper.get("svg")
    Object.defineProperty(canvas.element, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 20, width: 200, height: 100 })
    })
    const handle = wrapper.get('[aria-label="Middle"]')

    await handle.trigger("pointerdown", { button: 0, pointerId: 4 })
    await canvas.trigger("pointermove", { clientX: 210, clientY: 45, pointerId: 4 })

    expect(wrapper.emitted("moveHandle")?.at(-1)).toEqual([{ id: "middle", x: 0.75, y: 0.75 }])
  })

  it("supports the complete keyboard contract and updates the visible readout", async () => {
    const wrapper = mount(UiCurveEditor, { props: { curves, handles } })
    const handle = wrapper.get('[aria-label="Middle"]')

    await handle.trigger("focus")
    expect(wrapper.get("output").text()).toContain("Middle")
    await handle.trigger("keydown", { key: "ArrowRight" })
    await handle.trigger("keydown", { key: "ArrowDown" })
    await handle.trigger("keydown", { key: "Home" })
    await handle.trigger("keydown", { key: "End" })
    await handle.trigger("keydown", { key: "Escape" })

    expect(wrapper.emitted("moveHandle")?.slice(-4)).toEqual([
      [{ id: "middle", x: 0.51, y: 0.5 }],
      [{ id: "middle", x: 0.5, y: 0.49 }],
      [{ id: "middle", x: 0.5, y: 0 }],
      [{ id: "middle", x: 0.5, y: 1 }]
    ])
  })

  it("ends pointer drags and ignores disabled, non-primary, missing, and zero-sized moves", async () => {
    const wrapper = mount(UiCurveEditor, { props: { curves, handles } })
    const canvas = wrapper.get("svg")
    const handle = wrapper.get('[aria-label="Middle"]')
    Object.defineProperty(canvas.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 0, height: 0 })
    })

    await canvas.trigger("pointermove", { clientX: 10, clientY: 10, pointerId: 1 })
    await handle.trigger("pointerdown", { button: 1, pointerId: 1 })
    await handle.trigger("pointerdown", { button: 0, pointerId: 1 })
    await canvas.trigger("pointermove", { clientX: 10, clientY: 10, pointerId: 1 })
    await canvas.trigger("pointercancel", { pointerId: 1 })
    await canvas.trigger("pointermove", { clientX: 10, clientY: 10, pointerId: 1 })
    await canvas.trigger("pointerup", { pointerId: 1 })

    expect(wrapper.emitted("moveHandle")).toBeUndefined()

    await wrapper.setProps({ disabled: true })
    await handle.trigger("pointerdown", { button: 0, pointerId: 2 })
    await handle.trigger("keydown", { key: "ArrowUp" })
    expect(wrapper.attributes("data-disabled")).toBeDefined()
    expect(wrapper.emitted("moveHandle")).toBeUndefined()
  })
})
