import { createPinia, setActivePinia } from "pinia"
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LiveDocumentConfiguration } from "@heron/contracts"
import { PROJECT_SAMPLE_RATES } from "@heron/contracts"
import { rpcFailure, rpcSuccess, testBootstrap } from "../../test/ipc"
import { useAudioRuntimeStore } from "../../stores/audioRuntime"
import LiveDeviceSettings from "./LiveDeviceSettings.vue"

enableAutoUnmount(afterEach)
const configuration: LiveDocumentConfiguration = {
  name: "Stage",
  sampleRate: 48_000,
  audio: { backend: "asio", inputDeviceId: "input", outputDeviceId: "output", bufferSize: 128 },
  enabledMidiDeviceIds: ["controller"]
}

describe("Live device settings pending transaction", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAudioRuntimeStore().applyResources(testBootstrap().audioResources)
    Object.assign(window.heron, {
      listAudioBackends: vi.fn(async () =>
        rpcSuccess([{ id: "asio", label: "ASIO", available: true }])
      ),
      listAudioDevices: vi.fn(async () => rpcSuccess({ inputs: [], outputs: [] })),
      midiInputSnapshot: vi.fn(async () => rpcFailure("rendererErrors.engineUnavailable")),
      subscribeMidiInput: vi.fn(() => () => undefined)
    })
  })

  it("offers only supported sample rates and submits the selected rate", async () => {
    const wrapper = mount(LiveDeviceSettings, { props: { configuration, pending: false } })
    await flushPromises()
    const rate = wrapper.get('select[aria-label="Sample rate"]')
    expect(rate.findAll("option").map((option) => Number(option.element.value))).toEqual([
      ...PROJECT_SAMPLE_RATES
    ])
    await rate.setValue("96000")
    const save = wrapper.findAll("button").find((button) => button.text() === "Save device setup")!
    await save.trigger("click")
    expect(wrapper.emitted("configure")).toEqual([[{ ...configuration, sampleRate: 96000 }]])
    expect(configuration.sampleRate).toBe(48000)
  })

  it("locks the complete rig form while saving and restores editing afterward", async () => {
    const wrapper = mount(LiveDeviceSettings, { props: { configuration, pending: false } })
    await flushPromises()
    expect(wrapper.get("fieldset").attributes("disabled")).toBeUndefined()
    expect(wrapper.findAll("select").every((select) => !select.element.disabled)).toBe(true)

    await wrapper.setProps({ pending: true })
    expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined()
    expect(wrapper.findAll("select").every((select) => select.element.disabled)).toBe(true)
    expect(wrapper.get(".refresh-button").attributes("aria-disabled")).toBe("true")

    await wrapper.setProps({ pending: false })
    expect(wrapper.get("fieldset").attributes("disabled")).toBeUndefined()
    expect(wrapper.findAll("select").every((select) => !select.element.disabled)).toBe(true)
    expect(wrapper.get(".refresh-button").attributes("aria-disabled")).toBeUndefined()
    expect(wrapper.emitted("configure")).toBeUndefined()
  })
})
