import { mount } from "@vue/test-utils"
import { setActivePinia } from "pinia"
import { nextTick, shallowRef } from "vue"
import { describe, expect, it } from "vitest"
import { UiCascadingSelect } from "@heron/ui"
import type {
  MixerChannelCoreState,
  MixerChannelMeter,
  MixerGraphSnapshot,
  PluginDescriptor
} from "@heron/contracts"
import MixerSurface from "./MixerSurface.vue"
import MixerInputCapsule from "./MixerInputCapsule.vue"

function channel(id: string, kind: MixerChannelCoreState["kind"]): MixerChannelCoreState {
  return {
    id,
    kind,
    name: id,
    color: "#4F8CFF",
    sortOrder: 0,
    inputSource: kind === "audio" ? "hardware" : null,
    inputFormat: kind === "audio" ? "stereo" : null,
    inputChannels: kind === "audio" ? [5, 6] : [],
    hardwareOutputChannels: kind === "output" ? [3, 4] : [],
    outputChannelId: kind === "audio" ? "Output" : null,
    gainDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    inputMonitoring: false
  }
}
function graph(): MixerGraphSnapshot {
  return {
    sampleRate: 48_000,
    channels: [channel("Vocal", "audio"), channel("Master", "master"), channel("Output", "output")],
    sends: [],
    plugins: []
  }
}
const liveProps = {
  studioControls: false,
  applicationCaptureEnabled: false,
  pluginEditorsEnabled: false,
  hardwareInputCount: 0,
  hardwareOutputCount: 0,
  meterSource: () => undefined,
  displayOptions: {
    meterPeakHold: "800ms" as const,
    meterReturnRate: "iec-type-i" as const,
    softwareMonitoringEnabled: true
  }
}

describe("MixerSurface document ownership", () => {
  it("renders and edits core-only channels without initializing any Studio store", async () => {
    setActivePinia(undefined)
    const snapshot = graph()
    const wrapper = mount(MixerSurface, { props: { ...liveProps, graph: snapshot } })
    expect(wrapper.findAll(".channel-strip")).toHaveLength(3)
    expect(wrapper.find('[aria-label="Arm Vocal"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Bounce Output"]').exists()).toBe(false)
    expect(wrapper.find(".lucide-zap").exists()).toBe(false)
    expect(wrapper.find('[aria-label="Monitor Vocal"]').exists()).toBe(true)
    await wrapper.get('[aria-label="Mute Vocal"]').trigger("click")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["Vocal", { muted: true }])
    await wrapper.get('input[aria-label="Vocal volume"]').setValue("-6")
    expect(wrapper.emitted("preview")?.at(-1)).toEqual([
      { target: "channel", id: "Vocal", parameter: "gainDb", value: -6 }
    ])
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["Vocal", { gainDb: -6 }])
    expect(snapshot.channels[0]?.gainDb).toBe(0)
    expect(snapshot.channels[0]).not.toHaveProperty("recordArmed")
    expect(snapshot).not.toHaveProperty("tracks")
    wrapper.unmount()
  })

  it("retains exact saved physical routes while devices are unavailable", async () => {
    setActivePinia(undefined)
    const wrapper = mount(MixerSurface, { props: { ...liveProps, graph: graph() } })
    expect(wrapper.get('[aria-label="Vocal input channel"]').text()).toBe("IN 5–6")
    expect(
      wrapper.get('[aria-label="Use mono input for Vocal"]').attributes("disabled")
    ).toBeDefined()
    const input = wrapper.getComponent(MixerInputCapsule).getComponent(UiCascadingSelect)
    expect(input.props("groups")).toHaveLength(2)
    expect(input.props("groups")?.[0]?.options).toEqual([
      { value: "hardware:5", label: "IN 5–6", disabled: true }
    ])
    expect(wrapper.get('[aria-label="Output hardware output routing"]').text()).toBe("HW 3–4")
    expect(wrapper.emitted("updateChannel")).toBeUndefined()
    await wrapper.setProps({ hardwareInputCount: 8, hardwareOutputCount: 8 })
    expect(wrapper.get('[aria-label="Vocal input channel"]').text()).toBe("IN 5–6")
    expect(input.props("groups")?.[0]?.options).toHaveLength(4)
    expect(wrapper.emitted("updateChannel")).toBeUndefined()
    wrapper.unmount()
  })

  it("reads supplied telemetry in the existing meter without losing an in-progress edit", async () => {
    setActivePinia(undefined)
    const meter = shallowRef<MixerChannelMeter>({
      channelId: "Vocal",
      preFaderPeak: [0, 0],
      postFaderPeak: [0, 0],
      heldPeak: [0, 0],
      clipped: false
    })
    const wrapper = mount(MixerSurface, {
      props: {
        ...liveProps,
        graph: graph(),
        meterSource: (id) => (id === "Vocal" ? meter.value : undefined)
      }
    })
    await wrapper.get('[aria-label="Vocal volume value in decibels"]').trigger("dblclick")
    const editor = wrapper.get('input[aria-label="Vocal volume value in decibels"]')
    await editor.setValue("-3.5")
    meter.value = { ...meter.value, postFaderPeak: [0.5, 0.5] }
    await nextTick()
    expect((editor.element as HTMLInputElement).value).toBe("-3.5")
    expect(
      wrapper.get('[aria-label="Vocal latched maximum post-fader level in decibels"]').text()
    ).toBe("-6.0")
    await editor.trigger("blur")
    expect(wrapper.emitted("updateChannel")?.at(-1)).toEqual(["Vocal", { gainDb: -3.5 }])
    wrapper.unmount()
  })

  it("disables unavailable native editors while retaining document plug-in actions", async () => {
    setActivePinia(undefined)
    const snapshot = graph()
    const descriptor: PluginDescriptor = {
      source: { kind: "external" },
      locator: { format: "vst3", artifactPath: "effect.vst3", nativeId: "effect" },
      name: "Compressor",
      vendor: "Heron",
      version: "1.0",
      categories: ["Fx"],
      kind: "effect",
      architecture: "x86_64",
      buses: [],
      supportedAudioModes: ["stereo"],
      hasEditor: true,
      compatibility: "compatible",
      compatibilityReason: null
    }
    snapshot.plugins = [
      {
        id: "compressor",
        channelId: "Vocal",
        role: "insert",
        slotOrder: 0,
        locator: descriptor.locator,
        descriptor,
        audioMode: "stereo",
        enabled: true,
        sidechainInputs: [],
        state: { version: 1, chunks: [] }
      }
    ]
    const wrapper = mount(MixerSurface, { props: { ...liveProps, graph: snapshot } })
    expect(
      wrapper.get('[aria-label="Open Compressor editor"]').attributes("disabled")
    ).toBeDefined()
    await wrapper.get('[aria-label="Bypass Compressor"]').trigger("click")
    expect(wrapper.emitted("togglePlugin")).toEqual([["compressor", false]])
    await wrapper.get('[aria-label="Remove Compressor"]').trigger("click")
    expect(wrapper.emitted("removePlugin")).toEqual([["compressor"]])
    wrapper.unmount()
  })
})
