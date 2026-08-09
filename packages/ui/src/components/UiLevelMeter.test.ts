import { describe, expect, it } from "vitest"
import { mount } from "@vue/test-utils"

import UiLevelMeter from "./UiLevelMeter.vue"

describe("UiLevelMeter", () => {
  it("renders a reusable channel meter, scale, held peak, and clip state", () => {
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
    const channels = meter.findAll(":scope > span")
    expect(channels).toHaveLength(2)
    expect(channels[0]?.attributes("style")).toContain("--level-meter-level: 100%")
    expect(channels[0]?.find("i").exists()).toBe(true)
    expect(channels[1]?.attributes("style")).toContain("--level-meter-level: 36%")
    expect(channels[1]?.find("i").exists()).toBe(false)
    expect(wrapper.text()).toContain("−∞")
  })
})
