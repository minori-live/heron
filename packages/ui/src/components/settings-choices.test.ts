import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import UiActionRow from "./UiActionRow.vue"
import UiChoiceCard from "./UiChoiceCard.vue"

describe("settings choices", () => {
  it("reports selection from props and emits a selection intent without toggling itself", async () => {
    const wrapper = mount(UiChoiceCard, {
      props: { label: "Yamaha (C3)", description: "Middle C is labeled C3", selected: false }
    })
    const button = wrapper.get("button")
    expect(button.text()).toContain("Middle C is labeled C3")
    await button.trigger("click")
    expect(wrapper.emitted("select")).toEqual([[]])
    expect(button.attributes("aria-pressed")).toBe("false")
    await wrapper.setProps({ selected: true })
    expect(button.attributes("aria-pressed")).toBe("true")
    await wrapper.setProps({ disabled: true })
    await button.trigger("click")
    expect(wrapper.emitted("select")).toHaveLength(1)
  })

  it("keeps the profile name, description and action together in one accessible button", async () => {
    const wrapper = mount(UiActionRow, {
      props: { label: "Soft takeover", description: "Absolute curve" },
      slots: { trailing: "Built in · Duplicate" }
    })
    const button = wrapper.get("button")
    expect(button.text()).toContain("Soft takeover")
    expect(button.text()).toContain("Absolute curve")
    expect(button.text()).toContain("Built in · Duplicate")
    await button.trigger("click")
    expect(wrapper.emitted("activate")).toEqual([[]])
    await wrapper.setProps({ disabled: true })
    await button.trigger("click")
    expect(wrapper.emitted("activate")).toHaveLength(1)
  })
})
