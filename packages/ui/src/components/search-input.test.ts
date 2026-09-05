import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import UiSearchInput from "./UiSearchInput.vue"

describe("UiSearchInput", () => {
  it("labels the search field and emits text changes", async () => {
    const wrapper = mount(UiSearchInput, { props: { label: "Search assets", modelValue: "Kick" } })
    const input = wrapper.get('input[type="search"]')
    expect(input.attributes("aria-label")).toBe("Search assets")
    expect(input.attributes("placeholder")).toBe("Search assets")
    expect((input.element as HTMLInputElement).value).toBe("Kick")
    await input.setValue("Bass")
    expect(wrapper.emitted("update:modelValue")).toEqual([["Bass"]])
    await wrapper.setProps({ modelValue: "Piano" })
    expect((input.element as HTMLInputElement).value).toBe("Piano")
  })

  it("preserves the disabled state and custom placeholder", () => {
    const wrapper = mount(UiSearchInput, {
      props: { label: "Search assets", placeholder: "Name…", disabled: true }
    })
    expect(wrapper.get("input").attributes("disabled")).toBeDefined()
    expect(wrapper.get("input").attributes("placeholder")).toBe("Name…")
    expect(wrapper.get("svg").attributes("aria-hidden")).toBe("true")
  })
})
