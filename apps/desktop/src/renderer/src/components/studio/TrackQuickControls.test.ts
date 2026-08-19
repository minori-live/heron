import { describe, expect, it, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia } from "pinia"
import type { MixerChannelState } from "@heron/contracts"
import { useMixerRuntimeStore } from "../../stores/mixerRuntime"
import TrackQuickControls from "./TrackQuickControls.vue"

const channel: MixerChannelState = {
  id: "audio",
  kind: "audio",
  systemRole: null,
  name: "Vocal",
  color: "#8C83FF",
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

describe("TrackQuickControls", () => {
  it("uses live runtime telemetry when its composition parent does not inject a meter", () => {
    const pinia = createPinia()
    const runtimeStore = useMixerRuntimeStore(pinia)
    runtimeStore.runtime = {
      meters: [
        {
          channelId: "audio",
          preFaderPeak: [0.5, 0.5],
          postFaderPeak: [0.5, 0.5],
          heldPeak: [0.5, 0.5],
          clipped: false
        }
      ],
      capturedAt: 1
    }

    const wrapper = mount(TrackQuickControls, {
      props: { channel },
      global: { plugins: [pinia] }
    })

    const style = wrapper.get(".track-gain").attributes("style") ?? ""
    const displayedPercent = Number(
      /--horizontal-fader-meter-level:\s*([\d.]+)%/.exec(style)?.[1] ?? "NaN"
    )
    expect(displayedPercent).toBeGreaterThan(0)
  })

  it("returns its meter with the shared IEC Type I display envelope", async () => {
    let timestamp = 0
    const now = vi.spyOn(performance, "now").mockImplementation(() => timestamp)
    const wrapper = mount(TrackQuickControls, {
      props: {
        channel,
        meter: {
          channelId: "audio",
          preFaderPeak: [0.5, 0.5],
          postFaderPeak: [0.5, 0.5],
          heldPeak: [0.5, 0.5],
          clipped: false
        }
      },
      global: { plugins: [createPinia()] }
    })

    timestamp = 1_000
    await wrapper.setProps({
      meter: {
        channelId: "audio",
        preFaderPeak: [0.1, 0.1],
        postFaderPeak: [0.1, 0.1],
        heldPeak: [0.5, 0.5],
        clipped: false
      }
    })

    const style = wrapper.get(".track-gain").attributes("style") ?? ""
    const displayedPercent = Number(
      /--horizontal-fader-meter-level:\s*([\d.]+)%/.exec(style)?.[1] ?? "NaN"
    )
    expect(displayedPercent).toBeCloseTo(70.3, 1)

    wrapper.unmount()
    now.mockRestore()
  })

  it("provides mixer actions, metered gain, and pan gestures", async () => {
    const wrapper = mount(TrackQuickControls, {
      props: {
        channel,
        meter: {
          channelId: "audio",
          preFaderPeak: [0.5, 0.5],
          postFaderPeak: [0.5, 0.5],
          heldPeak: [0.5, 0.5],
          clipped: false
        }
      },
      global: { plugins: [createPinia()] }
    })

    await wrapper.get('button[aria-label="Mute Vocal"]').trigger("click")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["audio", { muted: true }])
    await wrapper.get('button[aria-label="Solo Vocal"]').trigger("click")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["audio", { soloed: true }])
    await wrapper.get('button[aria-label="Arm Vocal"]').trigger("click")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["audio", { recordArmed: true }])
    const monitor = wrapper.get('button[aria-label="Monitor Vocal"]')
    expect(monitor.attributes("disabled")).toBeUndefined()
    await monitor.trigger("click")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["audio", { inputMonitoring: true }])

    const gain = wrapper.get('input[aria-label="Vocal quick volume"]')
    await gain.trigger("pointerdown")
    ;(gain.element as HTMLInputElement).value = "-3"
    await gain.trigger("input")
    expect(wrapper.find(".ui-horizontal-fader__tooltip").exists()).toBe(true)
    await gain.trigger("change")
    await gain.setValue("-6")
    expect(wrapper.emitted("preview")?.at(-1)?.[0]).toMatchObject({
      target: "channel",
      id: "audio",
      parameter: "gainDb",
      value: -6
    })
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["audio", { gainDb: -6 }])
    expect(wrapper.get(".track-gain").attributes("style")).toContain(
      "--horizontal-fader-meter-level:"
    )

    const pan = wrapper.get('input[aria-label="Vocal quick pan"]')
    expect(wrapper.find(".track-pan output").exists()).toBe(false)
    await pan.setValue("-32")
    expect(wrapper.emitted("preview")?.at(-1)?.[0]).toMatchObject({
      target: "channel",
      id: "audio",
      parameter: "pan",
      value: -0.5
    })
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["audio", { pan: -0.5 }])

    await pan.trigger("pointerdown", { button: 0, pointerId: 7, clientY: 100 })
    await pan.trigger("pointermove", { pointerId: 7, clientY: 80 })
    expect(wrapper.emitted("preview")?.at(-1)?.[0]).toMatchObject({
      target: "channel",
      id: "audio",
      parameter: "pan",
      value: 11 / 63
    })
    await pan.trigger("pointerup", { pointerId: 7, clientY: 80 })
    expect(wrapper.emitted("updateChannel")?.at(-1)?.[1]).toMatchObject({
      pan: 11 / 63
    })

    await pan.trigger("keydown", { key: "F2" })
    const panEditor = wrapper.get('input[aria-label="Vocal quick pan value"]')
    await panEditor.setValue("32")
    await panEditor.trigger("blur")
    expect(wrapper.emitted("updateChannel")?.at(-1)?.[0]).toBe("audio")
    expect(wrapper.emitted("updateChannel")?.at(-1)?.[1]).toMatchObject({
      pan: 32 / 63
    })
  })

  it("keeps keyboard gain and pan previews local until their controlled commits", async () => {
    const wrapper = mount(TrackQuickControls, {
      props: {
        channel,
        meter: {
          channelId: "audio",
          preFaderPeak: [0, 0],
          postFaderPeak: [0, 0],
          heldPeak: [0, 0],
          clipped: false
        }
      },
      global: { plugins: [createPinia()] }
    })

    const gain = wrapper.get('input[aria-label="Vocal quick volume"]')
    ;(gain.element as HTMLInputElement).value = "-9"
    await gain.trigger("input")
    expect((gain.element as HTMLInputElement).value).toBe("-9")
    expect(gain.attributes("aria-valuetext")).toBe("-9.0 dB")
    ;(gain.element as HTMLInputElement).value = "0"
    await gain.trigger("change")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["audio", { gainDb: -9 }])

    const pan = wrapper.get('input[aria-label="Vocal quick pan"]')
    ;(pan.element as HTMLInputElement).value = "32"
    await pan.trigger("input")
    expect((pan.element as HTMLInputElement).value).toBe("32")
    expect(pan.attributes("aria-valuetext")).toBe("R32")
    ;(pan.element as HTMLInputElement).value = "0"
    await pan.trigger("change")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["audio", { pan: 32 / 63 }])
  })
})
