import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { UiCascadingSelect } from "@heron/ui"
import type { MixerChannelState } from "@heron/contracts"
import MixerOutputSection from "./MixerOutputSection.vue"

const channel: MixerChannelState = {
  id: "vocal",
  kind: "audio",
  systemRole: null,
  name: "Vocal",
  color: "#4F8CFF",
  sortOrder: 0,
  inputSource: "hardware",
  inputFormat: "mono",
  gainDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
  outputChannelId: "output",
  recordArmed: false,
  inputMonitoring: false,
  inputChannels: [1],
  hardwareOutputChannels: []
}

const output: MixerChannelState = {
  ...channel,
  id: "output",
  kind: "output",
  name: "Output 1–2",
  inputSource: null,
  inputFormat: null,
  outputChannelId: null,
  inputChannels: [],
  hardwareOutputChannels: [1, 2]
}

describe("MixerOutputSection", () => {
  it("routes processing channels to either a BUS or hardware Output", async () => {
    const wrapper = mount(MixerOutputSection, {
      props: {
        channel,
        buses: [{ channel: 7, name: "BUS 7" }],
        outputs: [output],
        targets: [
          { kind: "bus", bus: 7 },
          { kind: "bus", bus: 7, format: "stereo" },
          { kind: "output", channelId: "output" }
        ]
      }
    })

    const routeMenu = wrapper.getComponent(UiCascadingSelect)
    expect(routeMenu.props("appearance")).toBe("workspace")
    expect(routeMenu.props("groups")).toEqual([
      {
        label: "Mono",
        options: [{ value: "mono:bus:7", label: "BUS 7" }]
      },
      {
        label: "Stereo",
        options: [
          { value: "stereo:bus:7", label: "BUS 7–8" },
          { value: "stereo:output:output", label: "Output 1–2" }
        ]
      }
    ])

    routeMenu.vm.$emit("update:modelValue", "mono:bus:7")
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted("updateChannel")).toEqual([
      [{ outputChannelId: null, outputBus: 7, outputFormat: "mono" }]
    ])
    await wrapper.setProps({
      channel: { ...channel, outputChannelId: null, outputBus: 7, outputFormat: "mono" }
    })
    expect(routeMenu.props("modelValue")).toBe("mono:bus:7")
    routeMenu.vm.$emit("update:modelValue", "stereo:bus:7")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual([
      { outputChannelId: null, outputBus: 7, outputFormat: "stereo" }
    ])
  })

  it("preserves an explicit mono Output selection when reopening its menu", async () => {
    const wrapper = mount(MixerOutputSection, {
      props: {
        channel: { ...channel, outputChannelId: null, outputBus: 7, outputFormat: "stereo" },
        buses: [],
        outputs: [output],
        targets: [
          { kind: "bus", bus: 7, format: "stereo" },
          { kind: "output", channelId: "output", format: "mono" }
        ]
      }
    })
    const menu = wrapper.getComponent(UiCascadingSelect)
    expect(menu.props("modelValue")).toBe("stereo:bus:7")
    menu.vm.$emit("update:modelValue", "mono:output:output")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual([
      { outputChannelId: "output", outputBus: null, outputFormat: "mono" }
    ])
    await wrapper.setProps({ channel: { ...channel, outputFormat: "mono" } })
    expect(menu.props("modelValue")).toBe("mono:output:output")
  })

  it("uses a lightning icon and success state for the low-latency target", async () => {
    const wrapper = mount(MixerOutputSection, {
      props: {
        channel: output,
        buses: [],
        outputs: [output],
        targets: [],
        lowLatencyTarget: false,
        lowLatencyTargetDisabled: false
      }
    })

    const button = wrapper.get(
      'button[aria-label="Set Output 1–2 as the Low Latency Mode monitoring target"]'
    )
    expect(button.attributes("aria-pressed")).toBe("false")
    expect(button.find(".lucide-zap").exists()).toBe(true)
    await button.trigger("click")
    expect(wrapper.emitted("selectLowLatencyOutput")).toHaveLength(1)

    await wrapper.setProps({ lowLatencyTarget: true })
    expect(button.attributes("aria-pressed")).toBe("true")
    await wrapper.setProps({ lowLatencyTargetDisabled: true })
    expect(button.attributes("disabled")).toBeDefined()
    expect(button.attributes("aria-pressed")).toBe("true")
    await button.trigger("click")
    expect(wrapper.emitted("selectLowLatencyOutput")).toHaveLength(1)
    await wrapper.setProps({ lowLatencyTarget: false, lowLatencyTargetDisabled: false })
    expect(button.attributes("aria-pressed")).toBe("false")
  })
})
