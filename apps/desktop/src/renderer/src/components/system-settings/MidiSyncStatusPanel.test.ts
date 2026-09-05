import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import { i18n } from "../../i18n"
import MidiSyncStatusPanel from "./MidiSyncStatusPanel.vue"

afterEach(() => {
  i18n.global.locale.value = "en-US"
})

describe("MIDI sync localization", () => {
  it("updates status and fallback source when the language changes", async () => {
    const wrapper = mount(MidiSyncStatusPanel, {
      props: {
        sync: {
          state: "waiting",
          sourcePortId: null,
          sourcePortName: null,
          effectiveBpm: null,
          jitterMicroseconds: 0,
          lastClockAgeMs: null,
          droppedEvents: 2,
          ignoredSystemMessages: 0,
          error: null
        }
      }
    })
    expect(wrapper.text()).toContain("Waiting for clock")
    i18n.global.locale.value = "zh-cmn-Hans-CN"
    await nextTick()
    expect(wrapper.text()).toContain("等待时钟")
    expect(wrapper.text()).toContain("Heron 走带控制")
    expect(wrapper.text()).toContain("抖动")
    await wrapper.setProps({ sync: { ...wrapper.props("sync"), sourcePortName: "My MIDI Clock" } })
    expect(wrapper.text()).toContain("My MIDI Clock")
    wrapper.unmount()
  })
})
