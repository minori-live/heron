import { DOMWrapper, mount } from "@vue/test-utils"
import { afterEach, describe, expect, it } from "vitest"

import UiButton from "./UiButton.vue"
import UiCascadingMenu from "./UiCascadingMenu.vue"
import UiCascadingSelect from "./UiCascadingSelect.vue"
import UiCheckbox from "./UiCheckbox.vue"
import UiChoiceChip from "./UiChoiceChip.vue"
import UiField from "./UiField.vue"
import UiNumberInput from "./UiNumberInput.vue"
import UiProgress from "./UiProgress.vue"
import UiSegmentedControl from "./UiSegmentedControl.vue"
import UiSelect from "./UiSelect.vue"
import UiStatusNotice from "./UiStatusNotice.vue"
import UiTextInput from "./UiTextInput.vue"
import UiToolbar from "./UiToolbar.vue"

afterEach(() => {
  document.body.innerHTML = ""
})

describe("UI controls", () => {
  it("disables a loading button and exposes its busy state", () => {
    const wrapper = mount(UiButton, {
      props: { loading: true },
      slots: { default: "Save project" }
    })

    const button = wrapper.get("button")
    expect(button.attributes("disabled")).toBeDefined()
    expect(button.attributes("aria-busy")).toBe("true")
    expect(button.text()).toContain("Save project")
  })

  it("emits the edited text through the public input model", async () => {
    const wrapper = mount(UiTextInput, {
      props: {
        modelValue: "Initial"
      }
    })

    await wrapper.get("input").setValue("Renamed")
    expect(wrapper.emitted("update:modelValue")).toEqual([["Renamed"]])
  })

  it("updates checkbox v-model from a user interaction", async () => {
    const wrapper = mount(UiCheckbox, {
      props: { label: "Enable monitoring", modelValue: false }
    })

    await wrapper.get("input").setValue(true)
    expect(wrapper.emitted("update:modelValue")).toEqual([[true]])
  })

  it("selects one segmented option and exposes the pressed state", async () => {
    const wrapper = mount(UiSegmentedControl, {
      props: {
        label: "Editing tool",
        modelValue: "select",
        options: [
          { label: "Select", value: "select" },
          { label: "Draw", value: "draw" }
        ]
      }
    })

    const buttons = wrapper.findAll("button")
    expect(buttons[0]?.attributes("data-state")).toBe("on")
    await buttons[1]?.trigger("click")
    expect(wrapper.emitted("update:modelValue")).toEqual([["draw"]])
  })

  it("commits bounded numeric values from stepping, blur, and Enter", async () => {
    const wrapper = mount(UiNumberInput, {
      props: {
        modelValue: 64,
        min: 1,
        max: 127,
        size: "compact"
      },
      attrs: {
        "aria-label": "Velocity"
      }
    })

    const input = wrapper.get("input")
    expect(input.attributes("role")).toBe("spinbutton")
    expect(input.attributes("aria-valuemin")).toBe("1")

    await input.trigger("keydown", { key: "ArrowUp" })
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([65])
    await wrapper.setProps({ modelValue: 65 })

    await input.setValue("96")
    await input.trigger("blur")
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([96])
    await wrapper.setProps({ modelValue: 96 })

    await input.setValue("97")
    await input.trigger("keydown", { key: "Enter" })
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([97])
  })

  it("uses text and a signal rail for selected choices", async () => {
    const wrapper = mount(UiChoiceChip, {
      props: {
        label: "Verse",
        selected: true,
        signalColor: "var(--ui-signal-midi)"
      }
    })

    const button = wrapper.get("button")
    expect(button.attributes("aria-pressed")).toBe("true")
    expect(button.text()).toBe("Verse")
    await button.trigger("click")
    expect(wrapper.emitted("select")).toHaveLength(1)
  })

  it("smokes bare and composed toolbars through their accessible commands", () => {
    const wrapper = mount(UiToolbar, {
      props: {
        label: "Piano roll commands",
        density: "compact"
      },
      slots: {
        default: '<button type="button">Select</button>'
      }
    })

    expect(wrapper.attributes("role")).toBe("toolbar")
    expect(wrapper.attributes("aria-label")).toBe("Piano roll commands")
    expect(wrapper.get("button").text()).toBe("Select")

    const composed = mount(UiToolbar, {
      props: { label: "Transport" },
      slots: {
        start: '<button type="button">Record</button>',
        default: '<button type="button">Play</button>',
        end: '<button type="button">Settings</button>'
      }
    })
    expect(composed.attributes("role")).toBe("toolbar")
    expect(composed.attributes("aria-label")).toBe("Transport")
    expect(composed.findAll("button").map((button) => button.text())).toEqual([
      "Record",
      "Play",
      "Settings"
    ])
  })

  it("renders grouped select options with a separator and updates v-model", async () => {
    const wrapper = mount(UiSelect, {
      props: {
        modelValue: "major:0",
        size: "compact",
        groups: [
          {
            label: "Major keys",
            options: [{ label: "C Major", value: "major:0" }]
          },
          {
            label: "Minor keys",
            separatorBefore: true,
            options: [{ label: "A minor", value: "minor:0" }]
          }
        ]
      },
      attrs: {
        "aria-label": "Key signature"
      }
    })

    expect(wrapper.classes()).toContain("ui-select-shell--compact")
    expect(wrapper.get("select").attributes("aria-label")).toBe("Key signature")
    expect(wrapper.findAll("optgroup").map((group) => group.attributes("label"))).toEqual([
      "Major keys",
      "Minor keys"
    ])
    expect(wrapper.find(".ui-select__separator").exists()).toBe(true)
    await wrapper.get("select").setValue("minor:0")
    expect(wrapper.emitted("update:modelValue")).toEqual([["minor:0"]])
  })

  it("navigates cascading select groups and chooses a nested value", async () => {
    const wrapper = mount(UiCascadingSelect, {
      attachTo: document.body,
      props: {
        modelValue: "output",
        size: "compact",
        groups: [
          {
            label: "Outputs",
            options: [{ label: "Output 1–2", value: "output" }]
          },
          {
            label: "Buses",
            options: [{ label: "Reverb", value: "reverb" }]
          }
        ]
      },
      attrs: {
        "aria-label": "Vocal output"
      }
    })

    const trigger = wrapper.get("button")
    expect(trigger.text()).toBe("Output 1–2")
    expect(trigger.attributes("aria-label")).toBe("Vocal output")

    await trigger.trigger("click")
    const subTriggers = document.body.querySelectorAll<HTMLElement>(
      ".ui-cascading-select__sub-trigger"
    )
    expect([...subTriggers].map((item) => item.textContent?.trim())).toEqual(["Outputs", "Buses"])

    const buses = new DOMWrapper(subTriggers[1])
    await buses.trigger("focus")
    await buses.trigger("keydown", { key: "ArrowRight" })
    const busOption = new DOMWrapper(
      document.body.querySelector<HTMLElement>(".ui-cascading-select__item")
    )
    expect(busOption.text()).toBe("Reverb")
    await busOption.trigger("click")
    expect(wrapper.emitted("update:modelValue")).toEqual([["reverb"]])
  })

  it("disables empty cascading select groups instead of opening blank submenus", async () => {
    const wrapper = mount(UiCascadingSelect, {
      attachTo: document.body,
      props: {
        modelValue: "output",
        size: "compact",
        groups: [
          {
            label: "Outputs",
            options: [{ label: "Output 1–2", value: "output" }]
          },
          {
            label: "Buses",
            options: []
          }
        ]
      },
      attrs: {
        "aria-label": "Vocal output"
      }
    })

    await wrapper.get("button").trigger("click")
    const buses = [
      ...document.body.querySelectorAll<HTMLElement>(".ui-cascading-select__sub-trigger")
    ].find((item) => item.textContent?.includes("Buses"))
    expect(buses).toBeDefined()
    expect(buses?.getAttribute("data-disabled")).toBe("")
    expect(buses?.hasAttribute("disabled") || buses?.getAttribute("aria-disabled") === "true").toBe(
      true
    )
  })

  it("searches and chooses from a multi-level cascading menu", async () => {
    const wrapper = mount(UiCascadingMenu, {
      attachTo: document.body,
      props: {
        search: "",
        searchLabel: "Search audio effects",
        emptyMessage: "No effects found.",
        items: [
          {
            label: "Heron",
            ariaLabel: "Browse Heron plug-ins",
            children: [
              {
                label: "Delay",
                ariaLabel: "Choose Delay",
                children: [
                  {
                    label: "Stereo",
                    value: "delay:stereo",
                    leading: "S",
                    trailing: "2 → 2"
                  }
                ]
              }
            ]
          }
        ],
        "onUpdate:search": (value: string) => wrapper.setProps({ search: value })
      },
      slots: {
        default: '<button type="button">Add effect</button>'
      }
    })

    await wrapper.get("button").trigger("click")
    const search = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Search audio effects"]'
    )
    expect(search).not.toBeNull()
    await new DOMWrapper(search).setValue("delay")
    expect(wrapper.props("search")).toBe("delay")

    const modeElement = document.body.querySelector<HTMLElement>(".ui-cascading-menu__item")
    expect(modeElement).not.toBeNull()
    expect(modeElement?.textContent).toContain("Heron / Delay")
    const mode = new DOMWrapper(modeElement)
    await mode.trigger("click")

    expect(wrapper.emitted("select")).toEqual([["delay:stereo"]])
  })

  it("chooses a direct menu option from the embedded select appearance", async () => {
    const wrapper = mount(UiCascadingSelect, {
      attachTo: document.body,
      props: {
        modelValue: "1",
        size: "compact",
        appearance: "embedded",
        hoverTreatment: "host-tint",
        options: [
          { label: "IN 1", value: "1" },
          { label: "IN 2", value: "2" }
        ]
      },
      attrs: {
        "aria-label": "Audio input"
      }
    })

    const trigger = wrapper.get("button")
    expect(trigger.text()).toBe("IN 1")

    await trigger.trigger("click")
    const options = document.body.querySelectorAll<HTMLElement>(".ui-cascading-select__item")
    expect(options).toHaveLength(2)
    await new DOMWrapper(options[1]).trigger("click")

    expect(wrapper.emitted("update:modelValue")).toEqual([["2"]])
  })
})

describe("UI feedback semantics", () => {
  it("connects field help and error text through exposed slot ids", () => {
    const wrapper = mount(UiField, {
      props: {
        label: "Project name",
        description: "Shown in recent projects.",
        error: "A project name is required."
      },
      slots: {
        default: `
          <template #default="{ controlId, descriptionId, errorId }">
            <input :id="controlId" :aria-describedby="[descriptionId, errorId].filter(Boolean).join(' ')" />
          </template>
        `
      }
    })

    const input = wrapper.get("input")
    expect(wrapper.get("label").attributes("for")).toBe(input.attributes("id"))
    const descriptions = input
      .attributes("aria-describedby")!
      .split(" ")
      .map((id) => wrapper.get(`[id="${id}"]`).text())
    expect(descriptions).toEqual(["Shown in recent projects.", "A project name is required."])
    expect(wrapper.get('[role="alert"]').text()).toContain("required")
  })

  it("keeps field associations valid as validation feedback appears and clears", async () => {
    const wrapper = mount(UiField, {
      props: {
        label: "Velocity",
        layout: "inline"
      },
      slots: {
        default: `
          <template #default="{ controlId, descriptionId, errorId }">
            <input :id="controlId" :aria-describedby="[descriptionId, errorId].filter(Boolean).join(' ')" />
          </template>
        `
      }
    })

    expect(wrapper.get("label").attributes("for")).toBe(wrapper.get("input").attributes("id"))
    await wrapper.setProps({ description: "MIDI velocity", error: "Enter a value from 1 to 127." })
    const input = wrapper.get("input")
    const linkedText = () =>
      (input.attributes("aria-describedby") ?? "")
        .split(" ")
        .filter(Boolean)
        .map((id) => wrapper.get(`[id="${id}"]`).text())
    expect(linkedText()).toEqual(["MIDI velocity", "Enter a value from 1 to 127."])
    await wrapper.setProps({ id: "note-velocity", error: undefined })
    expect(input.attributes("id")).toBe("note-velocity")
    expect(wrapper.get("label").attributes("for")).toBe("note-velocity")
    expect(linkedText()).toEqual(["MIDI velocity"])
    await wrapper.setProps({ description: undefined })
    expect(linkedText()).toEqual([])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it("distinguishes determinate from indeterminate progress", async () => {
    const wrapper = mount(UiProgress, {
      props: { label: "Rendering stems", value: 25, max: 100 }
    })

    expect(wrapper.attributes("aria-valuenow")).toBe("25")
    await wrapper.setProps({ value: null })
    expect(wrapper.attributes("aria-valuenow")).toBeUndefined()
  })

  it("uses a live region only when requested", () => {
    const wrapper = mount(UiStatusNotice, {
      props: { tone: "danger", live: "assertive" },
      slots: { default: "Audio device disconnected." }
    })

    expect(wrapper.attributes("role")).toBe("alert")
    expect(wrapper.attributes("aria-live")).toBe("assertive")
  })
})
