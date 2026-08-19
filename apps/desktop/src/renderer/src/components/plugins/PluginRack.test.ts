import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"
import type { PluginDescriptor, PluginInstanceState } from "@heron/contracts"
import PluginRack from "./PluginRack.vue"
import { PLUGIN_DRAG_TYPE, serializePluginDrag, type PluginDragPayload } from "./plugin-drag"

const descriptor: PluginDescriptor = {
  source: { kind: "external" },
  locator: { format: "vst3", artifactPath: "/fx.vst3", nativeId: "fx" },
  name: "Effect",
  vendor: "Vendor",
  version: "1",
  categories: ["Fx"],
  kind: "effect",
  architecture: "x86_64",
  buses: [],
  supportedAudioModes: ["stereo"],
  hasEditor: true,
  compatibility: "compatible",
  compatibilityReason: null
}

function plugin(id: string, slotOrder: number): PluginInstanceState {
  return {
    id,
    channelId: "channel-1",
    role: "insert",
    slotOrder,
    locator: descriptor.locator,
    descriptor,
    audioMode: "stereo",
    enabled: true,
    sidechainInputs: [],
    state: { version: 1, chunks: [] }
  }
}

function dragEvent(payload?: PluginDragPayload, types: string[] = [PLUGIN_DRAG_TYPE]) {
  const value = payload ? serializePluginDrag(payload) : ""
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      types,
      dropEffect: "none",
      getData: vi.fn((mime: string) => (mime === PLUGIN_DRAG_TYPE ? value : ""))
    }
  } as unknown as DragEvent
}

function wrapper() {
  return mount(PluginRack, {
    props: {
      channelId: "channel-1",
      plugins: [plugin("first", 0), plugin("second", 1)],
      runtime: {}
    },
    global: {
      stubs: {
        PluginSlot: {
          props: ["plugin", "runtime"],
          emits: ["open", "toggle", "remove"],
          template:
            '<button class="slot" @click="$emit(\'open\', plugin.id)">{{ plugin.id }}</button>'
        }
      }
    }
  })
}

describe("PluginRack", () => {
  it("forwards slot actions", async () => {
    const mounted = wrapper()
    await mounted.find(".slot").trigger("click")
    expect(mounted.emitted("open")).toEqual([["first"]])
  })

  it("only activates a drop zone for the Heron drag type", async () => {
    const mounted = wrapper()
    const zone = mounted.find('[data-drop-index="1"]')

    await zone.trigger("dragover", dragEvent(undefined, ["text/plain"]))
    expect(zone.classes()).not.toContain("ui-drop-zone--active")

    await zone.trigger("dragover", dragEvent())
    expect(zone.classes()).toContain("ui-drop-zone--active")
    await zone.trigger("dragleave")
    expect(zone.classes()).not.toContain("ui-drop-zone--active")
  })

  it("inserts effect catalog entries and ignores instruments", async () => {
    const mounted = wrapper()
    const zone = mounted.find('[data-drop-index="2"]')

    await zone.trigger("drop", dragEvent({ source: "catalog", descriptor }))
    expect(mounted.emitted("insert")).toEqual([[descriptor, 2]])

    await zone.trigger(
      "drop",
      dragEvent({ source: "catalog", descriptor: { ...descriptor, kind: "instrument" } })
    )
    expect(mounted.emitted("insert")).toHaveLength(1)
  })

  it("adjusts forward rack moves and preserves backward destinations", async () => {
    const mounted = wrapper()
    await mounted
      .find('[data-drop-index="2"]')
      .trigger("drop", dragEvent({ source: "rack", instanceId: "first" }))
    await mounted
      .find('[data-drop-index="0"]')
      .trigger("drop", dragEvent({ source: "rack", instanceId: "second" }))
    expect(mounted.emitted("move")).toEqual([
      ["first", 1],
      ["second", 0]
    ])
  })

  it("does not emit when native drag data is invalid", async () => {
    const mounted = wrapper()
    await mounted.find('[data-drop-index="0"]').trigger("drop", dragEvent())
    expect(mounted.emitted("insert")).toBeUndefined()
    expect(mounted.emitted("move")).toBeUndefined()
  })
})
