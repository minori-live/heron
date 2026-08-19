import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"

import UiMixerInsert from "./UiMixerInsert.vue"

describe("UiMixerInsert", () => {
  it("labels the slot and exposes named content and action regions", async () => {
    const wrapper = mount(UiMixerInsert, {
      props: { label: "Compressor insert" },
      slots: {
        default: "Compressor",
        leading: "Grip",
        actions: '<button type="button">Remove</button>'
      }
    })

    expect(wrapper.attributes("aria-label")).toBe("Compressor insert")
    expect(wrapper.get(".ui-mixer-insert__content").text()).toBe("Compressor")
    expect(wrapper.get(".ui-mixer-insert__leading").text()).toBe("Grip")
    expect(wrapper.get(".ui-mixer-insert__actions").text()).toBe("Remove")
    await wrapper.trigger("pointerenter")
    expect(wrapper.classes()).toContain("is-hovered")
    await wrapper.trigger("pointerleave")
    expect(wrapper.classes()).not.toContain("is-hovered")
  })
})
