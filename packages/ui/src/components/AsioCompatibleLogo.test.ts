import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import AsioCompatibleLogo from "./AsioCompatibleLogo.vue"

describe("AsioCompatibleLogo", () => {
  it("renders labelled ASIO artwork", () => {
    const wrapper = mount(AsioCompatibleLogo)

    expect(wrapper.attributes("alt")).toBe("ASIO Compatible")
    expect(wrapper.attributes("src")).toBeTruthy()
  })

  it("can be decorative when adjacent copy identifies the trademark", () => {
    const wrapper = mount(AsioCompatibleLogo, { props: { decorative: true } })

    expect(wrapper.attributes("alt")).toBe("")
    expect(wrapper.attributes("aria-hidden")).toBe("true")
  })
})
