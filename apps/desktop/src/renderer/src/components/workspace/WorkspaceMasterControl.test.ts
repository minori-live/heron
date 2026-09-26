import { enableAutoUnmount, mount } from "@vue/test-utils"
import { setActivePinia } from "pinia"
import { afterEach, describe, expect, it } from "vitest"
import type { MixerChannelCoreState } from "@heron/contracts"
import WorkspaceMasterControl from "./WorkspaceMasterControl.vue"

enableAutoUnmount(afterEach)
const channel: MixerChannelCoreState = {
  id: "master",
  kind: "master",
  name: "Master",
  color: "#67D9E7",
  sortOrder: 0,
  inputSource: null,
  inputFormat: null,
  gainDb: -6,
  pan: 0,
  muted: false,
  soloed: false,
  outputChannelId: null,
  inputMonitoring: false,
  inputChannels: [],
  hardwareOutputChannels: []
}

describe("WorkspaceMasterControl", () => {
  it("renders and edits from props without any Pinia store", async () => {
    setActivePinia(undefined)
    const wrapper = mount(WorkspaceMasterControl, { props: { channel } })
    const fader = wrapper.get<HTMLInputElement>('input[aria-label="Master quick volume"]')
    expect(fader.element.value).toBe("-6")
    await fader.trigger("pointerdown")
    fader.element.value = "-12"
    await fader.trigger("input")
    await fader.trigger("change")
    expect(wrapper.emitted("preview")).toEqual([
      [{ target: "channel", id: "master", parameter: "gainDb", value: -12 }]
    ])
    expect(wrapper.emitted("updateChannel")).toEqual([["master", { gainDb: -12 }]])
  })

  it("retains the current value while disabled and shows a disabled empty master", async () => {
    setActivePinia(undefined)
    const wrapper = mount(WorkspaceMasterControl, { props: { channel, disabled: true } })
    const fader = wrapper.get<HTMLInputElement>('input[aria-label="Master quick volume"]')
    expect(fader.element.value).toBe("-6")
    expect(fader.element.disabled).toBe(true)
    await wrapper.setProps({ channel: null, disabled: false })
    expect(fader.element.disabled).toBe(true)
    expect(wrapper.emitted("updateChannel")).toBeUndefined()
  })
})
