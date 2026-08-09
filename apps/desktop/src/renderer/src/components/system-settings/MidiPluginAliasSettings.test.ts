import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { PluginInstanceState, PluginParameterInfo } from "@heron/contracts"
import MidiPluginAliasSettings from "./MidiPluginAliasSettings.vue"

const plugin = {
  id: "plugin-1",
  descriptor: { name: "Heron Synth", vendor: "Heron" },
  locator: { format: "vst3" },
  controlAlias: "lead"
} as PluginInstanceState

function parameter(
  parameterKey: string,
  overrides: Partial<PluginParameterInfo> = {}
): PluginParameterInfo {
  return {
    parameterKey,
    title: parameterKey,
    hidden: false,
    readOnly: false,
    automatable: true,
    ...overrides
  } as PluginParameterInfo
}

describe("MidiPluginAliasSettings", () => {
  it("explains why alias creation is unavailable without project plug-ins", () => {
    const wrapper = mount(MidiPluginAliasSettings, {
      props: { plugins: [], parameters: {}, aliasDrafts: {} }
    })

    expect(wrapper.text()).toContain("No project plug-ins available")
  })

  it("edits aliases and offers only writable automatable parameters", async () => {
    const wrapper = mount(MidiPluginAliasSettings, {
      props: {
        plugins: [plugin],
        parameters: {
          "plugin-1": [
            parameter("cutoff"),
            parameter("hidden", { hidden: true }),
            parameter("readonly", { readOnly: true }),
            parameter("manual", { automatable: false })
          ]
        },
        aliasDrafts: { "plugin-1": "draft-lead" }
      }
    })

    expect(wrapper.text()).toContain("Heron Synth")
    expect(wrapper.findAll("option").map((option) => option.attributes("value"))).toEqual([
      "",
      "cutoff"
    ])
    await wrapper.get('[aria-label="Heron Synth control alias"]').setValue("keys")
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Save"))!
      .trigger("click")
    await wrapper.get("select").setValue("cutoff")

    expect(wrapper.emitted("updateAlias")?.[0]).toEqual(["plugin-1", "keys"])
    expect(wrapper.emitted("saveAlias")?.[0]).toEqual(["plugin-1"])
    expect(wrapper.emitted("chooseParameter")?.[0]).toEqual(["lead", "cutoff"])
  })

  it("disables parameter selection when no eligible parameters are loaded", () => {
    const wrapper = mount(MidiPluginAliasSettings, {
      props: { plugins: [plugin], parameters: {}, aliasDrafts: {} }
    })

    expect(wrapper.get("select").attributes("disabled")).toBeDefined()
    expect(wrapper.text()).toContain("Open plug-in parameters to browse")
  })
})
