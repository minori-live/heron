import { afterEach, describe, expect, it } from "vitest"
import type { CompiledAudioGraphNode } from "@heron/contracts"
import { setAppLocale } from "../../i18n"
import { compiledGraphNodeLabel } from "./compiledGraphLabels"

const node: CompiledAudioGraphNode = {
  id: "input",
  kind: "hardware-input",
  label: "Hardware input",
  channelId: "channel-1",
  pluginInstanceId: null,
  signalWidth: "stereo",
  latencySamples: 0,
  pluginState: null
}
afterEach(() => setAppLocale("en-US"))

describe("native graph label presentation", () => {
  it("translates engine labels but retains user labels and port identifiers", () => {
    expect(compiledGraphNodeLabel(node)).toBe("Hardware input")
    setAppLocale("zh-cmn-Hans-CN")
    expect(compiledGraphNodeLabel(node)).toBe("硬件输入")
    expect(compiledGraphNodeLabel({ ...node, kind: "send", label: "Send (PostPan)" })).toBe(
      "发送（声像后）"
    )
    expect(
      compiledGraphNodeLabel({ ...node, kind: "pdc-delay", label: "Side-chain PDC · aux:1" })
    ).toBe("侧链延迟补偿 · aux:1")
    expect(compiledGraphNodeLabel({ ...node, kind: "channel" })).toBe("Hardware input")
    expect(compiledGraphNodeLabel({ ...node, kind: "effect", label: "Vendor DSP" })).toBe(
      "Vendor DSP"
    )
  })
})
