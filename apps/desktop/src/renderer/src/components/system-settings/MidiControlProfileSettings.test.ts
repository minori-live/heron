import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { MidiRelativeTransformProfile } from "@heron/contracts"
import { BUILTIN_MIDI_TRANSFORM_PROFILES } from "@heron/contracts"
import { UiNumberInput } from "@heron/ui"
import MidiControlProfileSettings from "./MidiControlProfileSettings.vue"

function relativeProfile(): MidiRelativeTransformProfile {
  return {
    id: "relative-custom",
    name: "Relative custom",
    type: "relative",
    baseStep: 0.01,
    acceleration: [{ eventsPerSecond: 5, multiplier: 1.5 }],
    builtin: false
  }
}

describe("MidiControlProfileSettings", () => {
  it("opens profiles and exposes explicit save and cancel actions", async () => {
    const profile = BUILTIN_MIDI_TRANSFORM_PROFILES.find(
      (candidate) => candidate.type === "absolute"
    )!
    const wrapper = mount(MidiControlProfileSettings, {
      props: { profiles: [profile], draft: profile }
    })

    expect(wrapper.text()).toContain("Absolute transform")
    expect(wrapper.text()).toContain("Built in")
    const row = wrapper.findAll("li button").find((button) => button.text().includes(profile.name))!
    expect(row.text()).toContain("Absolute curve")
    expect(row.text()).toContain("Built in")
    await row.trigger("click")
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Cancel")!
      .trigger("click")
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Save profile")!
      .trigger("click")

    expect(wrapper.emitted("edit")?.[0]).toEqual([profile])
    expect(wrapper.emitted("cancel")).toHaveLength(1)
    expect(wrapper.emitted("save")).toHaveLength(1)
  })

  it("edits relative base steps and acceleration points through visible controls", async () => {
    const draft = relativeProfile()
    const wrapper = mount(MidiControlProfileSettings, {
      props: { profiles: [draft], draft }
    })
    const inputs = wrapper.findAllComponents(UiNumberInput)

    inputs[0]!.vm.$emit("update:modelValue", 0.02)
    inputs[1]!.vm.$emit("update:modelValue", 12)
    inputs[2]!.vm.$emit("update:modelValue", 3)
    inputs[0]!.vm.$emit("update:modelValue", null)
    inputs[1]!.vm.$emit("update:modelValue", null)
    inputs[2]!.vm.$emit("update:modelValue", null)
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Add acceleration point"))!
      .trigger("click")
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Remove")!
      .trigger("click")

    const updates = wrapper.emitted("update:draft")!.map(([value]) => value)
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ baseStep: 0.02 }),
        expect.objectContaining({ baseStep: 0.001 }),
        expect.objectContaining({
          acceleration: expect.arrayContaining([{ eventsPerSecond: 20, multiplier: 2 }])
        }),
        expect.objectContaining({
          acceleration: [{ eventsPerSecond: 20, multiplier: 2 }]
        })
      ])
    )
  })

  it("ignores relative-only operations for an absolute draft", async () => {
    const profile = BUILTIN_MIDI_TRANSFORM_PROFILES.find(
      (candidate) => candidate.type === "absolute"
    )!
    const wrapper = mount(MidiControlProfileSettings, {
      props: { profiles: [profile], draft: profile }
    })

    expect(wrapper.text()).not.toContain("Add acceleration point")
    expect(wrapper.text()).toContain("Absolute transform")
  })
})
