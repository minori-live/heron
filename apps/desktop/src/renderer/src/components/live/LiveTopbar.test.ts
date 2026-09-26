import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { describe, expect, it } from "vitest"
import type { MixerChannelCoreState } from "@heron/contracts"
import LiveTopbar from "./LiveTopbar.vue"

const master: MixerChannelCoreState = {
  id: "live-master",
  kind: "master",
  name: "Master",
  color: "#4F8CFF",
  sortOrder: 0,
  inputSource: null,
  inputFormat: null,
  inputChannels: [],
  hardwareOutputChannels: [],
  gainDb: -7.5,
  pan: 0,
  muted: false,
  soloed: false,
  outputChannelId: null,
  inputMonitoring: false
}

describe("LiveTopbar", () => {
  it("keeps the master value while pending and never reads Studio meter state", async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(LiveTopbar, {
      props: {
        name: "Live",
        dirty: false,
        pending: false,
        leftPanelOpen: true,
        mixerOpen: true,
        master
      },
      global: { plugins: [pinia] }
    })
    const fader = wrapper.get('input[aria-label="Master quick volume"]')
    expect((fader.element as HTMLInputElement).value).toBe("-7.5")
    expect(Object.keys(pinia.state.value)).not.toContain("mixer-runtime")
    await wrapper.setProps({ pending: true })
    expect((fader.element as HTMLInputElement).value).toBe("-7.5")
    expect(fader.attributes("disabled")).toBeDefined()
    await wrapper.setProps({ pending: false })
    expect((fader.element as HTMLInputElement).value).toBe("-7.5")
    expect(fader.attributes("disabled")).toBeUndefined()
    expect(Object.keys(pinia.state.value)).not.toContain("mixer-runtime")
    wrapper.unmount()
  })
})
