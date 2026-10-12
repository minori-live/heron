import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { setAppLocale } from "../../i18n"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CompiledAudioGraphSnapshot } from "@heron/contracts"
import CompiledEffectGraphChart from "./CompiledEffectGraphChart.vue"

const UiNodeGraphStub = {
  name: "UiNodeGraph",
  props: ["nodes", "edges", "resetToken", "label"],
  template: '<div data-testid="node-graph" />'
}

vi.mock("./compiledEffectGraphLayout", () => ({
  layoutCompiledEffectGraph: () => ({
    nodes: [
      {
        id: "active",
        label: "Active",
        kind: "effect",
        pluginState: "active",
        latencySensitive: false,
        lowLatencyBypassed: false,
        latencySamples: 0,
        signalWidth: "stereo",
        x: 0,
        y: 0
      },
      {
        id: "bypassed",
        label: "Bypassed",
        kind: "effect",
        pluginState: "bypassed",
        latencySensitive: false,
        lowLatencyBypassed: false,
        latencySamples: 0,
        signalWidth: "stereo",
        x: 1,
        y: 0
      },
      {
        id: "unavailable",
        label: "Unavailable",
        kind: "effect",
        pluginState: "unavailable",
        latencySensitive: false,
        lowLatencyBypassed: false,
        latencySamples: 0,
        signalWidth: "mono",
        x: 2,
        y: 0
      },
      {
        id: "sensitive",
        label: "Sensitive",
        kind: "hardware-input",
        pluginState: null,
        latencySensitive: true,
        lowLatencyBypassed: false,
        latencySamples: 3,
        signalWidth: "mono",
        x: 3,
        y: 0
      },
      {
        id: "pdc",
        label: "PDC",
        kind: "pdc-delay",
        pluginState: null,
        latencySensitive: false,
        lowLatencyBypassed: false,
        latencySamples: 8,
        signalWidth: "stereo",
        x: 4,
        y: 0
      }
    ],
    edges: [
      { id: "audio", source: "active", target: "pdc", kind: "audio-route" },
      { id: "send", source: "active", target: "sensitive", kind: "send-route" }
    ]
  })
}))

const snapshot: CompiledAudioGraphSnapshot = {
  graphRevision: 1,
  buildGeneration: 1,
  sampleRate: 48_000,
  nodes: [],
  edges: []
}

afterEach(() => setAppLocale("en-US"))

describe("CompiledEffectGraphChart", () => {
  it("maps the compiled graph to the Storybook graph adapter", async () => {
    const wrapper = mount(CompiledEffectGraphChart, {
      props: { snapshot, resetToken: 0 },
      global: {
        stubs: {
          UiNodeGraph: UiNodeGraphStub
        }
      }
    })

    const graph = wrapper.getComponent(UiNodeGraphStub)
    expect(graph.props("nodes").map((node: { tone: string }) => node.tone)).toEqual([
      "info",
      "neutral",
      "neutral",
      "info",
      "warning"
    ])
    expect(graph.props("nodes")[2]).toMatchObject({ disabled: true })
    expect(graph.props("edges")).toEqual([
      { id: "audio", from: "active", to: "pdc", tone: "info" },
      { id: "send", from: "active", to: "sensitive", tone: "warning" }
    ])

    setAppLocale("zh-cmn-Hans-CN")
    await nextTick()
    expect(graph.props("nodes")[2].detail).toContain("状态：不可用")
    expect(graph.props("nodes")[2].detail).toContain("单声道")
    await wrapper.setProps({ resetToken: 2 })
    expect(graph.props("resetToken")).toBe(2)
    wrapper.unmount()
  })
})
