import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import { i18n } from "../../i18n"
import type { MidiControlAddress } from "@heron/contracts"
import { BUILTIN_MIDI_TRANSFORM_PROFILES } from "@heron/contracts"
import { UiNumberInput } from "@heron/ui"
import MidiControlMappingEditor from "./MidiControlMappingEditor.vue"

const address: MidiControlAddress = {
  portId: "port-1",
  portName: "Controller",
  channel: 0,
  type: "control-change",
  number: 7
}

function mountEditor(overrides: Record<string, unknown> = {}) {
  return mount(MidiControlMappingEditor, {
    props: {
      address,
      inputMode: "absolute",
      relativeEncoding: "one-127",
      targetType: "application-command",
      command: "project.save",
      mixerIndex: 0,
      mixerParameter: "gain",
      booleanBehavior: "toggle",
      profileId: "",
      pluginAlias: "",
      parameterKey: "",
      learning: false,
      profiles: BUILTIN_MIDI_TRANSFORM_PROFILES.filter((profile) => profile.type === "absolute"),
      monitor: { raw: 64, delta: -1, rate: 12.34, normalizedDelta: -1 / 127 },
      error: "",
      settingsError: "",
      ...overrides
    }
  })
}

function fieldControl(wrapper: ReturnType<typeof mountEditor>, label: string) {
  const fieldLabel = wrapper.findAll("label").find((candidate) => candidate.text() === label)
  expect(fieldLabel, `missing field label ${label}`).toBeDefined()
  return wrapper.get(`[id="${fieldLabel!.attributes("for")}"]`)
}

describe("MidiControlMappingEditor", () => {
  afterEach(() => {
    i18n.global.locale.value = "en-US"
  })

  it("updates choices and accessible labels without changing MIDI values", async () => {
    const wrapper = mountEditor({ targetType: "mixer" })
    expect(wrapper.text()).toContain("Control change")
    i18n.global.locale.value = "zh-cmn-Hans-CN"
    await nextTick()
    expect(wrapper.text()).toContain("控制器变化")
    expect(wrapper.text()).toContain("绝对值")
    expect(wrapper.text()).toContain("DAW 推子")
    expect(wrapper.text()).toContain("Controller")
    expect(wrapper.find('[aria-label="MIDI 输入监控"]').exists()).toBe(true)
    expect(wrapper.get('option[value="control-change"]').text()).toBe("控制器变化")
    expect(wrapper.emitted("update:address")).toBeUndefined()
    wrapper.unmount()
  })

  it("edits every hardware address field and emits the public form actions", async () => {
    const wrapper = mountEditor()

    expect(wrapper.text()).toContain("Controller")
    expect(wrapper.get('[aria-label="MIDI input monitor"]').text()).toContain("12.3 Hz")
    await fieldControl(wrapper, "Device name").setValue("Keys")
    await fieldControl(wrapper, "Device ID").setValue("keys-1")
    const numberInputs = wrapper.findAllComponents(UiNumberInput)
    numberInputs[0]!.vm.$emit("update:modelValue", 4)
    await fieldControl(wrapper, "Message").setValue("note")
    numberInputs[1]!.vm.$emit("update:modelValue", 60)
    await nextTick()

    expect(wrapper.emitted("update:address")).toEqual([
      [{ ...address, portName: "Keys" }],
      [{ ...address, portName: "Keys", portId: "keys-1" }],
      [{ ...address, portName: "Keys", portId: "keys-1", channel: 3 }],
      [{ ...address, portName: "Keys", portId: "keys-1", channel: 3, type: "note" }],
      [
        {
          ...address,
          portName: "Keys",
          portId: "keys-1",
          channel: 3,
          type: "note",
          number: 60
        }
      ]
    ])

    await wrapper.get("button").trigger("click")
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Cancel"))!
      .trigger("click")
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Save mapping"))!
      .trigger("click")
    expect(wrapper.emitted("learn")).toHaveLength(1)
    expect(wrapper.emitted("cancel")).toHaveLength(1)
    expect(wrapper.emitted("save")).toHaveLength(1)
  })

  it("renders relative, mixer boolean, plug-in, learning, and error states", async () => {
    const wrapper = mountEditor({
      inputMode: "relative",
      relativeEncoding: "twos-complement",
      targetType: "mixer",
      mixerParameter: "mute",
      learning: true,
      error: "Relative input supports only continuous targets."
    })

    expect(wrapper.text()).toContain("Listening for MIDI")
    expect(wrapper.text()).toContain("Two’s complement")
    expect(wrapper.text()).toContain("Behavior")
    expect(wrapper.get('[role="alert"]').text()).toContain("continuous targets")
    expect(wrapper.findAll("button").some((button) => button.text().includes("Listen again"))).toBe(
      false
    )

    await wrapper.setProps({ mixerParameter: "pan", error: "", learning: false })
    expect(wrapper.text()).toContain("Transform profile")
    expect(wrapper.text()).toContain("Listen again")

    await wrapper.setProps({
      targetType: "plugin-parameter",
      pluginAlias: "lead",
      parameterKey: "cutoff",
      settingsError: "Unable to save mapping"
    })
    expect(wrapper.text()).toContain("Control alias")
    expect(wrapper.text()).toContain("Parameter key")
    expect(wrapper.get('[role="alert"]').text()).toContain("Unable to save mapping")

    await wrapper.setProps({
      address: { ...address, type: "note" },
      targetType: "application-command",
      settingsError: ""
    })
    expect(wrapper.text()).toContain("Note 7")
    expect(wrapper.text()).toContain("Application command")
  })
})
