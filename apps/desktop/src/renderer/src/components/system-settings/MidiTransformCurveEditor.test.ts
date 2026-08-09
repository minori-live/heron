import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { MidiAbsoluteTransformProfile } from "@heron/contracts"
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
})
