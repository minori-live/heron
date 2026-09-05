import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import GlobalLaneHeader from "./GlobalLaneHeader.vue"

describe("GlobalLaneHeader", () => {
  it("keeps the tempo precision and unit, committing bounded edits instead of keystrokes", async () => {
    const wrapper = mount(GlobalLaneHeader, {
      props: {
        label: "Tempo",
        eyebrow: "Global track",
        value: 120,
        unit: "BPM",
        minimum: 20,
        maximum: 300,
        color: "var(--ui-domain-color-65a8ff)"
      }
    })
    const input = wrapper.get<HTMLInputElement>('[role="spinbutton"]')
    expect(input.element.value).toBe("120.00")
    expect(wrapper.text()).toContain("BPM")
    await input.setValue("137.25")
    expect(wrapper.emitted("updateValue")).toBeUndefined()
    await input.trigger("keydown", { key: "Enter" })
    expect(wrapper.emitted("updateValue")?.at(-1)).toEqual([137.25])
    await wrapper.setProps({ value: 137.25 })
    await input.setValue("900")
    await input.trigger("blur")
    expect(wrapper.emitted("updateValue")?.at(-1)).toEqual([300])
    await wrapper.setProps({ value: 300 })
    await input.setValue("")
    await input.trigger("blur")
    expect(
      wrapper
        .emitted("updateValue")
        ?.every(([value]) => typeof value === "number" && Number.isFinite(value))
    ).toBe(true)
    wrapper.unmount()
  })
})
