import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { describe, expect, it } from "vitest"
import type { MidiAbsoluteTransformProfile } from "@heron/contracts"
import { UiCurveEditor, UiNumberInput } from "@heron/ui"
import MidiTransformCurveEditor from "./MidiTransformCurveEditor.vue"

function profile(discontinuous = false): MidiAbsoluteTransformProfile {
  return {
    id: "custom",
    name: "Custom",
    type: "absolute",
    segments: [
      { inputStart: 0, inputEnd: 0.5, outputStart: 0, outputEnd: 0.5, kind: "linear" },
      {
        inputStart: 0.5,
        inputEnd: 1,
        outputStart: discontinuous ? 0.75 : 0.5,
        outputEnd: 1,
        kind: "linear"
      }
    ]
  }
}

describe("MidiTransformCurveEditor", () => {
  it("moves a continuous segment boundary as one shared handle", async () => {
    const wrapper = mount(MidiTransformCurveEditor, { props: { modelValue: profile() } })

    await wrapper.get('[aria-label="Segment 1 to 2 boundary"]').trigger("keydown", {
      key: "ArrowUp"
    })

    const updated = wrapper.emitted("update:modelValue")?.[0]?.[0] as MidiAbsoluteTransformProfile
    expect(updated.segments[0]!.outputEnd).toBeCloseTo(0.51)
    expect(updated.segments[1]!.outputStart).toBeCloseTo(0.51)
  })

  it("renders separate handles for an intentional discontinuity", () => {
    const wrapper = mount(MidiTransformCurveEditor, {
      props: { modelValue: profile(true) }
    })

    expect(wrapper.find('[aria-label="Segment 1 end"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Segment 2 start"]').exists()).toBe(true)
  })

  it("moves outer and discontinuous handles through the curve editor contract", async () => {
    const wrapper = mount(MidiTransformCurveEditor, {
      props: { modelValue: profile(true) }
    })
    const curve = wrapper.getComponent(UiCurveEditor)

    curve.vm.$emit("moveHandle", { id: "outer-start", x: 0, y: 0.2 })
    curve.vm.$emit("moveHandle", { id: "outer-end", x: 1, y: 0.8 })
    curve.vm.$emit("moveHandle", { id: "boundary-1-before", x: 0.4, y: 0.3 })
    curve.vm.$emit("moveHandle", { id: "boundary-1-after", x: 0.6, y: 0.7 })
    curve.vm.$emit("moveHandle", { id: "not-a-handle", x: 0.5, y: 0.5 })
    curve.vm.$emit("moveHandle", { id: "boundary-9", x: 0.5, y: 0.5 })
    await nextTick()

    const updates = wrapper
      .emitted("update:modelValue")!
      .map(([value]) => value as MidiAbsoluteTransformProfile)
    expect(updates[0]!.segments[0]!.outputStart).toBe(0.2)
    expect(updates[1]!.segments[1]!.outputEnd).toBe(0.8)
    expect(updates[2]!.segments[0]).toMatchObject({ inputEnd: 0.4, outputEnd: 0.3 })
    expect(updates[3]!.segments[1]).toMatchObject({ inputStart: 0.6, outputStart: 0.7 })
    expect(updates).toHaveLength(4)
  })

  it("updates the accessible segment table and splits and removes segments", async () => {
    const wrapper = mount(MidiTransformCurveEditor, { props: { modelValue: profile() } })
    const inputs = wrapper.findAllComponents(UiNumberInput)

    inputs[0]!.vm.$emit("update:modelValue", 0.1)
    inputs[1]!.vm.$emit("update:modelValue", null)
    inputs[2]!.vm.$emit("update:modelValue", 0.2)
    inputs[3]!.vm.$emit("update:modelValue", 0.4)
    inputs[4]!.vm.$emit("update:modelValue", null)
    await wrapper.get('[aria-label="Segment 1 shape"]').setValue("exponential")
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Split last segment"))!
      .trigger("click")
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Remove last segment"))!
      .trigger("click")

    const updates = wrapper
      .emitted("update:modelValue")!
      .map(([value]) => value as MidiAbsoluteTransformProfile)
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          segments: expect.arrayContaining([expect.objectContaining({ inputStart: 0.1 })])
        }),
        expect.objectContaining({
          segments: expect.arrayContaining([expect.objectContaining({ kind: "exponential" })])
        })
      ])
    )
    expect(updates.some((value) => value.segments.length === 3)).toBe(true)
    expect(updates.some((value) => value.segments.length === 1)).toBe(true)
  })

  it("handles an empty profile without producing invalid updates", async () => {
    const wrapper = mount(MidiTransformCurveEditor, {
      props: { modelValue: { ...profile(), segments: [] } }
    })

    expect(wrapper.findAll('[role="slider"]')).toHaveLength(0)
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Split last segment"))!
      .trigger("click")
    expect(wrapper.emitted("update:modelValue")).toBeUndefined()
  })
})
