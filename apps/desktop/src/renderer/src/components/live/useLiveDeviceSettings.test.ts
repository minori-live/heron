import { createPinia, setActivePinia } from "pinia"
import { flushPromises, mount } from "@vue/test-utils"
import { defineComponent } from "vue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AudioDeviceList, LiveDocumentConfiguration, RpcResult } from "@heron/contracts"
import { PROJECT_SAMPLE_RATES } from "@heron/contracts"
import { rpcFailure, rpcSuccess, testBootstrap } from "../../test/ipc"
import { useAudioRuntimeStore } from "../../stores/audioRuntime"
import { useLiveDeviceSettings } from "./useLiveDeviceSettings"

const configuration: LiveDocumentConfiguration = {
  name: "Live",
  sampleRate: 48_000,
  audio: {
    backend: "asio",
    inputDeviceId: "saved-input",
    outputDeviceId: "saved-output",
    bufferSize: 128
  },
  enabledMidiDeviceIds: ["missing-controller"]
}
const devices: AudioDeviceList = {
  inputs: [
    {
      id: "default-input",
      name: "Default input",
      isDefault: true,
      defaultSampleRate: 48_000,
      minBufferSize: 32,
      maxBufferSize: 2048,
      channelCount: 2
    }
  ],
  outputs: [
    {
      id: "default-output",
      name: "Default output",
      isDefault: true,
      defaultSampleRate: 48_000,
      minBufferSize: 32,
      maxBufferSize: 2048,
      channelCount: 2
    }
  ]
}

function setup(value = configuration) {
  let settings!: ReturnType<typeof useLiveDeviceSettings>
  const wrapper = mount(
    defineComponent({
      setup() {
        settings = useLiveDeviceSettings(() => value)
        return () => null
      }
    })
  )
  return { settings, wrapper }
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAudioRuntimeStore().applyResources(testBootstrap().audioResources)
  Object.assign(window.heron, {
    listAudioBackends: vi.fn(async () =>
      rpcSuccess([
        { id: "asio", label: "ASIO", available: true },
        { id: "wasapi", label: "WASAPI", available: true }
      ])
    ),
    listAudioDevices: vi.fn(async () => rpcSuccess(devices)),
    midiInputSnapshot: vi.fn(async () => rpcFailure("rendererErrors.engineUnavailable")),
    subscribeMidiInput: vi.fn(() => () => undefined)
  })
})

describe("Live device configuration", () => {
  it("validates exactly the project sample rates accepted by persistence", async () => {
    const { settings, wrapper } = setup()
    await flushPromises()
    for (const rate of PROJECT_SAMPLE_RATES) {
      settings.updateSampleRate(rate)
      expect(settings.valid.value).toBe(true)
    }
    for (const rate of [8000, 44101, 48000.5, 384000, NaN]) {
      settings.updateSampleRate(rate)
      expect(settings.valid.value).toBe(false)
    }
    expect(configuration.sampleRate).toBe(48000)
    wrapper.unmount()
  })
  it("keeps exact saved IDs and MIDI allowlist when discovered default devices differ", async () => {
    const { settings, wrapper } = setup()
    await flushPromises()
    expect(settings.draft.value).toEqual(configuration)
    expect(settings.dirty.value).toBe(false)
    expect(settings.inputOptions.value).toContainEqual({
      value: "saved-input",
      label: "saved-input (Missing)"
    })
    expect(settings.outputOptions.value).toContainEqual({
      value: "saved-output",
      label: "saved-output (Missing)"
    })
    expect(settings.midiPorts.value).toContainEqual({
      id: "missing-controller",
      name: "missing-controller",
      connected: false
    })
    expect(settings.valid.value).toBe(true)
    wrapper.unmount()
  })

  it("does not choose a backend or rig for a document that has none", async () => {
    const value = { ...configuration, audio: null }
    const { settings, wrapper } = setup(value)
    await flushPromises()
    expect(settings.backend.value).toBe("")
    expect(settings.draft.value.audio).toBeNull()
    expect(window.heron.listAudioDevices).not.toHaveBeenCalled()
    settings.toggleMidiPort("new-controller", true)
    expect(settings.draft.value.enabledMidiDeviceIds).toEqual([
      "missing-controller",
      "new-controller"
    ])
    expect(settings.valid.value).toBe(true)
    expect(value.enabledMidiDeviceIds).toEqual(["missing-controller"])
    wrapper.unmount()
  })

  it("requires explicit device choices after the backend changes and ignores stale discovery", async () => {
    let resolveOld!: (result: RpcResult<AudioDeviceList>) => void
    Object.assign(window.heron, {
      listAudioDevices: vi.fn((_, backend) =>
        backend === "asio"
          ? new Promise<RpcResult<AudioDeviceList>>((resolve) => {
              resolveOld = resolve
            })
          : Promise.resolve(rpcSuccess(devices))
      )
    })
    const { settings, wrapper } = setup()
    await flushPromises()
    settings.selectBackend("wasapi")
    await flushPromises()
    expect(settings.draft.value.audio).toEqual({
      backend: "wasapi",
      inputDeviceId: "",
      outputDeviceId: "",
      bufferSize: 128
    })
    expect(settings.valid.value).toBe(false)
    resolveOld(rpcSuccess({ inputs: [], outputs: [] }))
    await flushPromises()
    expect(settings.inputOptions.value.some((item) => item.value === "default-input")).toBe(true)
    settings.updateAudio({ inputDeviceId: "default-input", outputDeviceId: "default-output" })
    expect(settings.valid.value).toBe(true)
    wrapper.unmount()
  })

  it("keeps backend failure visible and unsubscribes when its dialog closes", async () => {
    const unsubscribe = vi.fn()
    Object.assign(window.heron, {
      listAudioBackends: vi.fn(async () => rpcFailure("rendererErrors.queryBackends")),
      subscribeMidiInput: vi.fn(() => unsubscribe)
    })
    const { settings, wrapper } = setup()
    await flushPromises()
    expect(settings.discoveryError.value).toBe("Unable to query cpal backends.")
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
