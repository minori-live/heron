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
})
