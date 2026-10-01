import { afterEach, describe, expect, it } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import type { LiveHierarchy, LiveRuntimeSnapshot } from "@heron/contracts"
import LiveLayerFields from "./LiveLayerFields.vue"
import { i18n } from "../../i18n"

const t = i18n.global.t
const snapshot: LiveRuntimeSnapshot = {
  graph: {
    sampleRate: 48000,
    channels: [
      {
        id: "voice",
        kind: "audio",
        name: "Voice",
        color: "#4F8CFF",
        sortOrder: 0,
        inputSource: "hardware",
        inputFormat: "stereo",
        inputChannels: [1, 2],
        hardwareOutputChannels: [],
        inputMonitoring: false,
        outputChannelId: null,
        outputBus: null,
        gainDb: -6,
        pan: 0,
        muted: false,
        soloed: false
      }
    ],
    sends: [],
    plugins: []
  },
  parameterValues: []
}
const hierarchy: LiveHierarchy = {
  sets: [
    {
      id: "set",
      name: "Acoustic",
      sortOrder: 0,
      overrides: [{ type: "channel", id: "voice", parameter: "gainDb", value: -6 }]
    }
  ],
  patches: [{ id: "patch", setId: "set", name: "Opening", sortOrder: 0, overrides: [] }]
}
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe("Live field ownership", () => {
  it("shows defining layers and explicitly creates an equal override before offering Revert", async () => {
    const wrapper = mount(LiveLayerFields, {
      attachTo: document.body,
      props: {
        snapshot,
        hierarchy,
        selectedLayerId: "patch",
        selectedChannelId: "voice",
        pending: false,
        error: ""
      }
    })
    wrappers.push(wrapper)
    expect(wrapper.findAll("dd").map((row) => row.text())).toEqual([
      "Acoustic",
      t("live.layers.project"),
      t("live.layers.project"),
      t("live.layers.project")
    ])
    await wrapper.get("button").trigger("click")
    await flushPromises()
    const button = (key: string) =>
      document.querySelector<HTMLButtonElement>(
        `button[aria-label="${t(key, { field: t("live.layers.fields.gainDb") })}"]`
      )!
    button("live.layers.overrideField").click()
    expect(wrapper.emitted("edit")).toEqual([
      [
        {
          type: "set-live-override",
          layerId: "patch",
          override: { type: "channel", id: "voice", parameter: "gainDb", value: -6 }
        }
      ]
    ])
    await wrapper.setProps({
      hierarchy: {
        ...hierarchy,
        patches: [
          {
            ...hierarchy.patches[0]!,
            overrides: [{ type: "channel", id: "voice", parameter: "gainDb", value: -6 }]
          }
        ]
      }
    })
    expect(wrapper.findAll("dd")[0]!.text()).toBe("Opening")
    button("live.layers.revertField").click()
    expect(wrapper.emitted("edit")?.[1]).toEqual([
      {
        type: "revert-live-override",
        layerId: "patch",
        field: { type: "channel", id: "voice", parameter: "gainDb" }
      }
    ])
    await wrapper.setProps({ pending: true })
    expect(button("live.layers.revertField").disabled).toBe(true)
  })
})
