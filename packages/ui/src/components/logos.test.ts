import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"

import AsioCompatibleLogo from "./AsioCompatibleLogo.vue"
import HeronLogo from "./HeronLogo.vue"
import VstCompatibleLogo from "./VstCompatibleLogo.vue"

describe("third-party compatibility logos", () => {
  it("exposes the ASIO trademark as an accessible name and can be hidden from it", () => {
    const labelled = mount(AsioCompatibleLogo)
    expect(labelled.attributes("alt")).toBe("ASIO Compatible")

    const decorative = mount(AsioCompatibleLogo, { props: { decorative: true } })
    expect(decorative.attributes("alt")).toBe("")
    expect(decorative.attributes("aria-hidden")).toBe("true")
  })

  it("exposes the VST trademark as an accessible name across surface variants", () => {
    const onDark = mount(VstCompatibleLogo)
    expect(onDark.attributes("alt")).toBe("VST Compatible")

    const onLight = mount(VstCompatibleLogo, { props: { appearance: "on-light" } })
    expect(onLight.attributes("alt")).toBe("VST Compatible")

    const decorative = mount(VstCompatibleLogo, { props: { decorative: true } })
    expect(decorative.attributes("alt")).toBe("")
    expect(decorative.attributes("aria-hidden")).toBe("true")
  })
})

describe("HeronLogo", () => {
  it("exposes the brand name by default and can be hidden from assistive technology", () => {
    const labelled = mount(HeronLogo)
    expect(labelled.attributes("role")).toBe("img")
    expect(labelled.attributes("aria-label")).toBe("Heron")
    expect(labelled.text()).toBe("Heron")

    const decorative = mount(HeronLogo, { props: { decorative: true } })
    expect(decorative.attributes("aria-hidden")).toBe("true")
    expect(decorative.attributes("role")).toBeUndefined()
    expect(decorative.attributes("aria-label")).toBeUndefined()
  })

  it("keeps only the wordmark text for the wordmark variant and none for the mark", async () => {
    const wrapper = mount(HeronLogo, { props: { variant: "wordmark" } })
    expect(wrapper.text()).toBe("Heron")

    await wrapper.setProps({ variant: "mark" })
    expect(wrapper.text()).toBe("")
  })
})
