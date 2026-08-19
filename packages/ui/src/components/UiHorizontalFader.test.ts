import { describe, expect, it } from "vitest"
import { mount } from "@vue/test-utils"

import UiHorizontalFader from "./UiHorizontalFader.vue"

const props = {
  value: 0,
  min: -90,
  max: 12,
  step: 0.1,
  defaultValue: 0,
  label: "Vocal quick volume",
  valueText: (value: number) => (value <= -90 ? "−∞ dB" : `${value.toFixed(1)} dB`),
  meterLevelPercent: 62
}

describe("UiHorizontalFader", () => {
  it("keeps a horizontal meter shape and exposes value semantics", () => {
    const wrapper = mount(UiHorizontalFader, { props })
    const input = wrapper.get('input[type="range"]')

    expect(wrapper.classes()).toContain("ui-horizontal-fader")
    expect(wrapper.attributes("style")).toContain("--horizontal-fader-meter-level: 62%")
    expect(wrapper.attributes("style")).toContain("--horizontal-fader-value-position")
    expect(wrapper.find(".ui-horizontal-fader__rail").exists()).toBe(true)
    expect(wrapper.find(".ui-horizontal-fader__meter").exists()).toBe(true)
    expect(wrapper.find(".ui-horizontal-fader__value").exists()).toBe(false)
    expect(wrapper.find(".ui-horizontal-fader__thumb").exists()).toBe(true)
    expect(input.attributes("aria-valuetext")).toBe("0.0 dB")
  })

  it("previews, commits, cancels, and resets without leaking DOM events", async () => {
    const wrapper = mount(UiHorizontalFader, { props })
    const input = wrapper.get('input[type="range"]')

    await input.trigger("pointerdown")
    ;(input.element as HTMLInputElement).value = "-12"
    await input.trigger("input")
    expect(wrapper.emitted("preview")?.at(-1)).toEqual([-12])

    await input.trigger("keydown", { key: "Escape" })
    await input.trigger("change")
    expect(wrapper.emitted("preview")?.at(-1)).toEqual([0])
    expect(wrapper.emitted("commit")).toBeUndefined()

    await input.setValue("-6")
    expect(wrapper.emitted("commit")?.at(-1)).toEqual([-6])
    await input.trigger("dblclick")
    expect(wrapper.emitted("commit")?.at(-1)).toEqual([0])
  })
})
