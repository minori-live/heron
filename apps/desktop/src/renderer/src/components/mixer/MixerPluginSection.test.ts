import { afterEach, describe, expect, it } from "vitest"
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils"
import type { MixerChannelState, PluginDescriptor, PluginInstanceState } from "@heron/contracts"
import { PLUGIN_DRAG_TYPE } from "../plugins/plugin-drag"
import MixerPluginSection from "./MixerPluginSection.vue"

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

const descriptor: PluginDescriptor = {
  source: { kind: "external" },
  locator: { format: "vst3", artifactPath: "compressor.vst3", nativeId: "compressor" },
  name: "Compressor",
  vendor: "Heron Studio",
  version: "1.0",
  categories: ["Fx"],
  kind: "effect",
  architecture: "x86_64",
  buses: [],
  supportedAudioModes: ["mono", "mono-to-stereo", "stereo", "dual-mono"],
  hasEditor: true,
  compatibility: "compatible",
  compatibilityReason: null
}

const plugin: PluginInstanceState = {
  id: "plugin",
  channelId: "audio",
  role: "insert",
  slotOrder: 0,
  locator: descriptor.locator,
  descriptor,
  audioMode: "stereo",
  enabled: true,
  sidechainInputs: [],
  state: { version: 1, chunks: [] }
}

function rackDragData(instanceId: string) {
  return {
    types: [PLUGIN_DRAG_TYPE],
    effectAllowed: "move",
    dropEffect: "none",
    setData: () => undefined,
    getData: () => JSON.stringify({ source: "rack", instanceId })
  }
}

async function openPickerSubmenu(ariaLabel: string): Promise<void> {
  const trigger = document.body.querySelector<HTMLElement>(`[aria-label="${ariaLabel}"]`)
  expect(trigger).not.toBeNull()
  const menuTrigger = new DOMWrapper(trigger)
  await menuTrigger.trigger("focus")
  await menuTrigger.trigger("keydown", { key: "ArrowRight" })
  await flushPromises()
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("MixerPluginSection", () => {
  it("offers compact open, bypass, remove, catalog drop, and empty-slot picker actions", async () => {
    const nextDescriptor = {
      ...descriptor,
      locator: { ...descriptor.locator, nativeId: "delay" },
      name: "Delay"
    }
    const wrapper = mount(MixerPluginSection, {
      attachTo: document.body,
      props: {
        channel,
        inserts: [plugin],
        runtime: {},
        effectPlugins: [nextDescriptor],
        slotRows: 4,
        initialInputWidth: "mono"
      }
    })

    await wrapper.get('button[aria-label="Open Compressor editor"]').trigger("click")
    expect(wrapper.emitted("open")?.at(-1)).toEqual(["plugin"])
    const pluginRow = wrapper.get('[aria-label="Compressor plugin active"]')
    expect(pluginRow.classes()).toContain("active")
    expect(pluginRow.find("i").exists()).toBe(false)
    expect(pluginRow.get(".plugin-actions").text()).toBe("S")
    expect(pluginRow.attributes("draggable")).toBeUndefined()
    expect(wrapper.get('[aria-label="Move Compressor"]').attributes("draggable")).toBe("true")
    await wrapper.get('button[aria-label="Bypass Compressor"]').trigger("click")
    expect(wrapper.emitted("toggle")?.at(-1)).toEqual(["plugin", false])
    await wrapper.get('button[aria-label="Remove Compressor"]').trigger("click")
    expect(wrapper.emitted("remove")?.at(-1)).toEqual(["plugin"])
    expect(
      wrapper.get('button[aria-label="Open Compressor editor"]').attributes("data-variant")
    ).toBe("plain")
    expect(wrapper.get('button[aria-label="Remove Compressor"]').attributes("data-variant")).toBe(
      "danger-ghost"
    )
    expect(wrapper.get('button[aria-label="Remove Compressor"]').classes()).toContain(
      "ui-icon-button--compact"
    )
    expect(wrapper.findAll(".plugin-row.empty")).toHaveLength(1)
    expect(wrapper.get('button[aria-label="Add VST3 audio effect"]').text()).toBe("")
    expect(wrapper.findAll(".plugin-row.alignment-spacer")).toHaveLength(2)

    await wrapper.find(".plugin-row.empty").trigger("drop", {
      dataTransfer: {
        types: [PLUGIN_DRAG_TYPE],
        getData: () =>
          JSON.stringify({
            source: "catalog",
            descriptor: nextDescriptor
          })
      }
    })
    expect(wrapper.emitted("insert")).toBeUndefined()
    await wrapper.get('button[title="Dual mono: 2 × (1 → 1)"]').trigger("click")
    expect(wrapper.emitted("insert")?.at(-1)).toEqual([
      { descriptor: nextDescriptor, audioMode: "dual-mono" },
      1
    ])

    const pickerTrigger = wrapper.get('button[aria-label="Add VST3 audio effect"]')
    await pickerTrigger.trigger("click")
    await flushPromises()
    expect(
      document.body.querySelector('input[aria-label="Search VST3 audio effects"]')
    ).not.toBeNull()
    await openPickerSubmenu("Browse Heron Studio plug-ins")
    await openPickerSubmenu("Choose Delay")
    expect(wrapper.emitted("insert")).toHaveLength(1)
    const stereoMode = document.body.querySelector<HTMLElement>('[title="Stereo: 2 → 2"]')
    expect(stereoMode).not.toBeNull()
    await new DOMWrapper(stereoMode).trigger("click")
    expect(wrapper.emitted("insert")?.at(-1)).toEqual([
      { descriptor: nextDescriptor, audioMode: "stereo" },
      1
    ])

    await wrapper.setProps({ inserts: [{ ...plugin, enabled: false }] })
    expect(wrapper.get('[aria-label="Compressor plugin bypassed"]').classes()).toContain("bypassed")

    await wrapper.setProps({
      runtime: {
        plugin: {
          instanceId: "plugin",
          state: "active",
          editorOpen: true,
          latencySamples: 0,
          tailSamples: 0,
          error: null
        }
      }
    })
    expect(wrapper.get('[aria-label="Compressor plugin bypassed"]').classes()).toContain("bypassed")
    expect(wrapper.get('button[aria-label="Enable Compressor"]').attributes("aria-pressed")).toBe(
      "false"
    )

    await wrapper.setProps({
      runtime: {
        plugin: {
          instanceId: "plugin",
          state: "failed",
          editorOpen: false,
          latencySamples: 0,
          tailSamples: 0,
          error: "Could not load"
        }
      }
    })
    expect(wrapper.get('[aria-label="Compressor plugin failed"]').classes()).toContain("failed")
  })

  it("offers only mono-input modes at the start of a mono insert chain", async () => {
    const wrapper = mount(MixerPluginSection, {
      attachTo: document.body,
      props: {
        channel,
        inserts: [],
        runtime: {},
        effectPlugins: [descriptor],
        slotRows: 1,
        initialInputWidth: "mono"
      }
    })

    await wrapper.get('button[aria-label="Add VST3 audio effect"]').trigger("click")
    await flushPromises()
    const search = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Search VST3 audio effects"]'
    )
    expect(search).not.toBeNull()
    await new DOMWrapper(search).setValue("missing")
    expect(document.body.textContent).toContain("No plug-ins match this search.")
    await new DOMWrapper(search).setValue("compressor")

    expect(document.body.querySelector('[title="Mono: 1 → 1"]')).not.toBeNull()
    expect(document.body.querySelector('[title="Mono to stereo: 1 → 2"]')).not.toBeNull()
    expect(document.body.querySelector('[title="Stereo: 2 → 2"]')).toBeNull()
    expect(document.body.querySelector('[title="Dual mono: 2 × (1 → 1)"]')).toBeNull()
    wrapper.unmount()
  })

  it("offers retry instead of changing creative bypass after a contained failure", async () => {
    const wrapper = mount(MixerPluginSection, {
      props: {
        channel,
        inserts: [plugin],
        runtime: {
          plugin: {
            instanceId: "plugin",
            state: "failed",
            editorOpen: false,
            failure: {
              instanceId: "plugin",
              instanceGeneration: 3,
              graphRevision: 17,
              category: "invalid-output",
              stage: "process",
              outcome: "failed",
              recoverable: true,
              diagnosticId: "plugin:plugin:process",
              message: "The plug-in produced non-finite audio."
            },
            latencySamples: 0,
            tailSamples: 0,
            error: "The plug-in produced non-finite audio."
          }
        },
        effectPlugins: [],
        slotRows: 1,
        initialInputWidth: "stereo"
      }
    })

    expect(wrapper.get('[aria-label="Compressor plugin failed"]').attributes("title")).toBe(
      "The plug-in produced non-finite audio."
    )
    await wrapper.get('button[aria-label="Retry Compressor"]').trigger("click")
    expect(wrapper.emitted("retry")?.at(-1)).toEqual(["plugin"])
    expect(wrapper.emitted("toggle")).toBeUndefined()
  })

  it("snaps rack moves before or after a row and previews the final slot", async () => {
    const delayDescriptor = {
      ...descriptor,
      locator: { ...descriptor.locator, nativeId: "delay" },
      name: "Delay"
    }
    const delayPlugin: PluginInstanceState = {
      ...plugin,
      id: "delay-plugin",
      locator: delayDescriptor.locator,
      descriptor: delayDescriptor,
      slotOrder: 1
    }
    const wrapper = mount(MixerPluginSection, {
      props: {
        channel,
        inserts: [plugin, delayPlugin],
        runtime: {},
        effectPlugins: [],
        slotRows: 3,
        initialInputWidth: "stereo"
      }
    })

    const compressorGrip = wrapper.get('[aria-label="Move Compressor"]')
    const delayGrip = wrapper.get('[aria-label="Move Delay"]')
    const compressorDrag = rackDragData("plugin")

    await compressorGrip.trigger("dragstart", { dataTransfer: compressorDrag })
    const afterPreview = wrapper.findAll(".ui-drop-zone")[2]!
    await afterPreview.trigger("dragover", { clientY: 121, dataTransfer: compressorDrag })
    expect(afterPreview.classes()).toContain("ui-drop-zone--active")

    await afterPreview.trigger("drop", { dataTransfer: compressorDrag })
    expect(wrapper.emitted("move")?.at(-1)).toEqual(["plugin", 1])
    expect(afterPreview.classes()).not.toContain("ui-drop-zone--active")
    await compressorGrip.trigger("dragend", { dataTransfer: compressorDrag })

    const delayDrag = rackDragData("delay-plugin")
    await delayGrip.trigger("dragstart", { dataTransfer: delayDrag })
    const beforePreview = wrapper.findAll(".ui-drop-zone")[0]!
    await beforePreview.trigger("dragover", { clientY: 103, dataTransfer: delayDrag })
    expect(beforePreview.classes()).toContain("ui-drop-zone--active")

    await delayGrip.trigger("dragend", { dataTransfer: delayDrag })
    window.dispatchEvent(new Event("dragend"))
    await wrapper.vm.$nextTick()
    expect(beforePreview.classes()).not.toContain("ui-drop-zone--active")
  })

  it("transfers the snap preview when a drag enters an adjacent mixer strip", async () => {
    const adjacentDescriptor = {
      ...descriptor,
      locator: { ...descriptor.locator, nativeId: "adjacent-fx" },
      name: "Adjacent FX"
    }
    const adjacentPlugin: PluginInstanceState = {
      ...plugin,
      id: "adjacent-plugin",
      channelId: "adjacent",
      locator: adjacentDescriptor.locator,
      descriptor: adjacentDescriptor
    }
    const commonProps = {
      runtime: {},
      effectPlugins: [],
      slotRows: 2,
      initialInputWidth: "stereo" as const
    }
    const sourceStrip = mount(MixerPluginSection, {
      props: {
        ...commonProps,
        channel,
        inserts: [plugin]
      }
    })
    const adjacentStrip = mount(MixerPluginSection, {
      props: {
        ...commonProps,
        channel: { ...channel, id: "adjacent", name: "Adjacent" },
        inserts: [adjacentPlugin]
      }
    })
    const sourceGrip = sourceStrip.get('[aria-label="Move Compressor"]')
    const dragData = rackDragData("plugin")

    await sourceGrip.trigger("dragstart", { dataTransfer: dragData })
    const sourceZone = sourceStrip.findAll(".ui-drop-zone")[0]!
    const adjacentZone = adjacentStrip.findAll(".ui-drop-zone")[0]!
    await sourceZone.trigger("dragover", { clientY: 103, dataTransfer: dragData })
    expect(sourceZone.classes()).toContain("ui-drop-zone--active")

    await sourceZone.trigger("dragleave")
    await adjacentZone.trigger("dragover", { clientY: 103, dataTransfer: dragData })
    expect(sourceZone.classes()).not.toContain("ui-drop-zone--active")
    expect(adjacentZone.classes()).toContain("ui-drop-zone--active")

    await sourceGrip.trigger("dragend", { dataTransfer: dragData })
    window.dispatchEvent(new Event("dragend"))
    await adjacentStrip.vm.$nextTick()
    expect(adjacentZone.classes()).not.toContain("ui-drop-zone--active")
    sourceStrip.unmount()
    adjacentStrip.unmount()
  })
})
