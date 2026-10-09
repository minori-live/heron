import { describe, expect, it } from "vitest"
import { mount } from "@vue/test-utils"

import UiLevelMeter from "./UiLevelMeter.vue"
import UiMixerInsert from "./UiMixerInsert.vue"
import UiMixerStateButton from "./UiMixerStateButton.vue"

describe("UiMixerInsert", () => {
  it("labels the slot, composes its regions, and reveals affordances on hover", async () => {
    const wrapper = mount(UiMixerInsert, {
      props: { label: "Compressor insert" },
      slots: {
        default: "Compressor",
        leading: "Grip",
        actions: '<button type="button">Remove</button>'
      }
    })

    expect(wrapper.attributes("aria-label")).toBe("Compressor insert")
    expect(wrapper.text()).toContain("Compressor")
    expect(wrapper.text()).toContain("Grip")
    expect(wrapper.text()).toContain("Remove")
    await wrapper.trigger("pointerenter")
    expect(wrapper.classes()).toContain("is-hovered")
    await wrapper.trigger("pointerleave")
    expect(wrapper.classes()).not.toContain("is-hovered")
  })
})

describe("UiMixerStateButton", () => {
  it("keeps pressed semantics separate from the effective active state", async () => {
    const wrapper = mount(UiMixerStateButton, {
      props: {
        label: "Monitor Vocal",
        tone: "input",
        size: "narrow",
        joined: "end",
        pressed: true,
        active: false,
        disabled: true
      },
      slots: { default: "I" }
    })

    const button = wrapper.get("button")
    expect(button.attributes("aria-label")).toBe("Monitor Vocal")
    expect(button.attributes("aria-pressed")).toBe("true")
    expect(button.classes()).not.toContain("active")
    expect(button.attributes()).toHaveProperty("disabled")

    await button.trigger("click")
    expect(wrapper.emitted("click")).toBeUndefined()
  })
})

describe("UiLevelMeter", () => {
  it("exposes per-channel values, held peak, and clip state", () => {
    const wrapper = mount(UiLevelMeter, {
      props: {
        channels: [
          { levelPercent: 120, heldLevelPercent: 82, hasHeldPeak: true },
          { levelPercent: 36, heldLevelPercent: 48, hasHeldPeak: false }
        ],
        clipped: true,
        label: "Vocal post-fader level",
        marks: [
          { value: 0, label: "0", position: 0, emphasis: true },
          { value: -60, label: "−∞", position: 100 }
        ]
      }
    })

    const meter = wrapper.get('[role="meter"]')
    expect(meter.attributes("aria-valuenow")).toBe("100")
    expect(meter.attributes("aria-valuetext")).toBe("L 100%, R 36%")
    expect(meter.attributes("aria-label")).toBe("Vocal post-fader level")
    expect(meter.classes()).toContain("clipped")
    expect(meter.findAll(":scope > span")).toHaveLength(2)
    expect(wrapper.text()).toContain("−∞")
  })
})
