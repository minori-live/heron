import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import { UiCascadingSelect } from "@heron/ui"
import { setAppLocale } from "../../i18n"
import { keySignatureLabel } from "../../utils/keySignatures"
import KeySignatureDropdown from "./KeySignatureDropdown.vue"

afterEach(() => setAppLocale("en-US"))

describe("key signature localization", () => {
  it("updates the selected key and both option groups without changing key identities", async () => {
    const wrapper = mount(KeySignatureDropdown, { props: { modelValue: "major:-5" } })
    try {
      expect(wrapper.text()).toContain("D♭ Major")
      setAppLocale("zh-cmn-Hans-CN")
      await nextTick()
      expect(wrapper.text()).toContain("D♭ 大调")
      const groups = wrapper.getComponent(UiCascadingSelect).props("groups")
      expect(groups?.[0]?.options.find((option) => option.value === "major:7")?.label).toBe(
        "C♯ 大调"
      )
      expect(groups?.[1]?.options.find((option) => option.value === "minor:-7")?.label).toBe(
        "A♭ 小调"
      )
      expect(keySignatureLabel(99, "minor")).toBe("A 小调")
      setAppLocale("en-US")
      await nextTick()
      expect(wrapper.text()).toContain("D♭ Major")
      expect(wrapper.emitted("update:modelValue")).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })
})
