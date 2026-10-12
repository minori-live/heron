import { afterEach, describe, expect, it } from "vitest"
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import type { MixerBusState, MixerChannelState, MixerSendState } from "@heron/contracts"
import { UiCascadingSelect, UiRotaryControl } from "@heron/ui"
import { setAppLocale } from "../../i18n"
import MixerSendSection from "./MixerSendSection.vue"

const channel: MixerChannelState = {
  id: "audio",
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

const bus: MixerBusState = {
  channel: 7,
  name: "BUS 7"
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

const send: MixerSendState = {
  id: "send",
  sourceChannelId: "audio",
  targetBus: 7,
  sortOrder: 0,
  enabled: true,
  tap: "post",
  levelDb: -12
}

// Send menus teleport into `document.body`, so wrappers must unmount between tests.
enableAutoUnmount(afterEach)
afterEach(() => setAppLocale("en-US"))

describe("MixerSendSection", () => {
  it("edits all three send positions and parameter gestures from the compact row", async () => {
    const wrapper = mount(MixerSendSection, {
      attachTo: document.body,
      props: {
        channel,
        sends: [send],
        buses: [bus],
        outputs: [output],
        sendTargets: [{ kind: "output", channelId: "output" }],
        slotRows: 1
      }
    })

    expect(wrapper.get(".send-row").attributes("data-tap")).toBe("post")
    expect(wrapper.get('button[aria-label="Edit send to BUS 7"]').text()).toBe("BUS 7")
    expect(wrapper.text()).not.toContain("EMPTY SEND")
    expect(wrapper.find('button[aria-label="Add send in empty slot"]').exists()).toBe(false)

    const level = wrapper.get('input[aria-label="BUS 7 send level"]')
    await level.setValue("-6")
    expect(wrapper.emitted("preview")?.at(-1)?.[0]).toMatchObject({
      target: "send",
      id: "send",
      parameter: "levelDb",
      value: -6
    })
    expect(wrapper.emitted("updateSend")?.at(-1)).toEqual(["send", { levelDb: -6 }])

    await wrapper.get('button[aria-label="Edit send to BUS 7"]').trigger("click")
    await flushPromises()

    const tapButtons = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(".tap-options button")
    )
    const enabledToggle = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Disable send"]'
    )
    expect(enabledToggle?.getAttribute("aria-pressed")).toBe("true")
    expect(tapButtons.map((button) => button.textContent?.trim())).toEqual(["PRE", "POST", "PAN"])
    setAppLocale("zh-cmn-Hans-CN")
    await flushPromises()
    expect(tapButtons.map((button) => button.textContent?.trim())).toEqual([
      "推子前",
      "推子后",
      "声像后"
    ])
    expect(wrapper.get("button.send-config").attributes("title")).toBe("BUS 7 · 推子后 · -12.0 dB")
    await new DOMWrapper(tapButtons[2]).trigger("click")
    expect(wrapper.emitted("updateSend")?.at(-1)).toEqual(["send", { tap: "post-pan" }])
    setAppLocale("en-US")
    await flushPromises()

    expect(document.body.querySelector('[aria-label="Send pan"]')).toBeNull()
    expect(document.body.querySelector('[aria-label="Send level"]')).toBeNull()

    const destination = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Send target"]'
    )
    expect(destination?.textContent?.trim()).toBe("BUS 7")
    expect(document.body.querySelector('select[aria-label="Send target"]')).toBeNull()
    await new DOMWrapper(destination).trigger("click")
    await flushPromises()
    const destinationGroups = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    )
    expect(destinationGroups.map((button) => button.textContent?.trim())).toEqual([
      "Mono",
      "Stereo"
    ])
    await new DOMWrapper(destinationGroups[1]).trigger("keydown", { key: "ArrowRight" })
    await flushPromises()
    const outputOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    ).find((button) => button.textContent?.trim() === "Output 1–2")
    await new DOMWrapper(outputOption).trigger("click")
    expect(wrapper.emitted("updateSend")?.at(-1)).toEqual([
      "send",
      { targetChannelId: "output", targetBus: null, targetFormat: "stereo" }
    ])
  })

  it("shows both BUS lanes and retains the format when retargeting an existing send", async () => {
    const wrapper = mount(MixerSendSection, {
      attachTo: document.body,
      props: {
        channel,
        sends: [{ ...send, targetFormat: "stereo" }],
        buses: [bus],
        outputs: [output],
        sendTargets: [{ kind: "bus", bus: 9, format: "stereo" }],
        slotRows: 1
      }
    })
    await wrapper.get('button[aria-label="Edit send to BUS 7–8"]').trigger("click")
    await flushPromises()
    const menu = wrapper
      .findAllComponents(UiCascadingSelect)
      .find((candidate) => candidate.props("modelValue") === "stereo:bus:7")!
    expect(menu.props("groups")![1]!.options).toContainEqual({
      value: "stereo:bus:7",
      label: "BUS 7–8"
    })
    menu.vm.$emit("update:modelValue", "stereo:bus:9")
    expect(wrapper.emitted("updateSend")?.at(-1)).toEqual([
      "send",
      { targetChannelId: null, targetBus: 9, targetFormat: "stereo" }
    ])
    await wrapper.setProps({
      sends: [{ ...send, targetBus: null, targetChannelId: "output", targetFormat: "mono" }]
    })
    expect(wrapper.get('button[aria-label="Edit send to Output 1–2"]').text()).toBe("Output 1–2")
    expect(menu.props("modelValue")).toBe("mono:output:output")
  })

  it("uses Logic position and a stronger ring without redundant row labels", async () => {
    const wrapper = mount(MixerSendSection, {
      props: {
        channel,
        sends: [{ ...send, tap: "pre" }],
        buses: [bus],
        outputs: [output],
        sendTargets: [],
        slotRows: 1
      }
    })

    expect(wrapper.get(".send-row").attributes("data-tap")).toBe("pre")
    expect(wrapper.getComponent(UiRotaryControl).props("dragRangePixels")).toBe(180)

    await wrapper.setProps({ sends: [{ ...send, tap: "post-pan" }] })
    expect(wrapper.get(".send-row").attributes("data-tap")).toBe("post-pan")
  })

  it("adds a send from available BUS and Output targets", async () => {
    const wrapper = mount(MixerSendSection, {
      attachTo: document.body,
      props: {
        channel,
        sends: [],
        buses: [bus],
        outputs: [output],
        sendTargets: [
          { kind: "bus", bus: 7 },
          { kind: "output", channelId: "output" }
        ],
        slotRows: 1
      }
    })

    expect(wrapper.find(".send-row.alignment-spacer").exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Add send"]').exists()).toBe(false)
    expect(wrapper.get('button[aria-label="Add send in empty slot"]').text()).toBe("")

    await wrapper.get('button[aria-label="Add send in empty slot"]').trigger("click")
    await flushPromises()
    const routeGroups = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    )
    expect(routeGroups.map((button) => button.textContent?.trim())).toEqual(["Mono", "Stereo"])

    await new DOMWrapper(routeGroups[0]).trigger("keydown", { key: "ArrowRight" })
    await flushPromises()
    const busOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    ).find((button) => button.textContent?.trim() === "BUS 7")
    await new DOMWrapper(busOption).trigger("click")
    expect(wrapper.emitted("addSend")?.at(-1)).toEqual([{ kind: "bus", bus: 7, format: "mono" }])

    await wrapper.get('button[aria-label="Add send in empty slot"]').trigger("click")
    await flushPromises()
    const outputGroup = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    ).find((button) => button.textContent?.trim() === "Stereo")
    await new DOMWrapper(outputGroup).trigger("keydown", { key: "ArrowRight" })
    await flushPromises()
    const outputOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    ).find((button) => button.textContent?.trim() === "Output 1–2")
    await new DOMWrapper(outputOption).trigger("click")
    expect(wrapper.emitted("addSend")?.at(-1)).toEqual([
      { kind: "output", channelId: "output", format: "stereo" }
    ])
  })
})
