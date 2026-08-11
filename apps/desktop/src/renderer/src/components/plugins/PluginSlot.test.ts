import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { PluginInstanceState, PluginRuntimeStatus } from "@heron/contracts"
import PluginSlot from "./PluginSlot.vue"

const plugin: PluginInstanceState = {
  id: "fx-1",
  channelId: "audio-1",
  role: "insert",
  slotOrder: 0,
  locator: { format: "vst3", artifactPath: "/fx.vst3", nativeId: "fx" },
  descriptor: {
    source: { kind: "external" },
    locator: { format: "vst3", artifactPath: "/fx.vst3", nativeId: "fx" },
    name: "Effect",
    vendor: "Vendor",
    version: "1",
    categories: ["Fx"],
    kind: "effect",
    supportedAudioModes: ["stereo"],
    architecture: "x86_64",
    buses: [],
    hasEditor: true,
    compatibility: "compatible",
    compatibilityReason: null
  },
  audioMode: "stereo",
  enabled: true,
  sidechainInputs: [],
  state: { version: 1, chunks: [] }
}

const failed: PluginRuntimeStatus = {
  instanceId: plugin.id,
  state: "failed",
  editorOpen: false,
  failureStage: "process",
  failure: {
    instanceId: plugin.id,
    instanceGeneration: 3,
    graphRevision: 17,
    category: "invalid-output",
    stage: "process",
    outcome: "failed",
    recoverable: true,
    diagnosticId: "plugin:fx-1:process",
    message: "the plug-in produced non-finite audio"
  },
  latencySamples: 0,
  tailSamples: 0,
  error: "the plug-in produced non-finite audio"
}

describe("PluginSlot", () => {
  it("shows a contained failure and turns the power action into an explicit retry", async () => {
    const wrapper = mount(PluginSlot, { props: { plugin, runtime: failed } })

    expect(wrapper.get('[role="status"]').text()).toContain("non-finite audio")
    const retry = wrapper.get('button[aria-label="Retry Effect"]')
    await retry.trigger("click")

    expect(wrapper.emitted("open")).toEqual([[plugin.id]])
    expect(wrapper.emitted("toggle")).toBeUndefined()
  })
})
