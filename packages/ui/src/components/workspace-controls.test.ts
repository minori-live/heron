import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UI_DOMAIN_COLORS } from "../domainColors"

import UiActionRow from "./UiActionRow.vue"
import UiButton from "./UiButton.vue"
import UiChoiceCard from "./UiChoiceCard.vue"
import UiColorInput from "./UiColorInput.vue"
import UiForm from "./UiForm.vue"
import UiIconButton from "./UiIconButton.vue"
import UiMixerSlot from "./UiMixerSlot.vue"
import UiMixerStateButton from "./UiMixerStateButton.vue"
import UiSettingsNavigator from "./UiSettingsNavigator.vue"
import UiTabs from "./UiTabs.vue"
import UiTextarea from "./UiTextarea.vue"
import UiWindowControls from "./UiWindowControls.vue"
import UiZoomControl from "./UiZoomControl.vue"

enableAutoUnmount(afterEach)

describe("workspace controls", () => {
  it("preserves action-row descriptions and adornments with selected and disabled feedback", async () => {
    const plain = mount(UiActionRow, { props: { label: "Audio" } })
    expect(plain.text()).toBe("Audio")
    expect(plain.attributes("aria-current")).toBeUndefined()
    const row = mount(UiActionRow, {
      props: { label: "Audio", description: "Backend settings", selected: true },
      slots: { leading: "Audio icon", trailing: "ASIO" }
    })
    expect(row.text()).toContain("Backend settings")
    expect(row.text()).toContain("Audio icon")
    expect(row.text()).toContain("ASIO")
    expect(row.attributes("aria-current")).toBe("true")
    await row.trigger("click")
    expect(row.emitted("activate")).toEqual([[]])
    await row.setProps({ description: undefined, selected: false, disabled: true })
    expect(row.text()).not.toContain("Backend settings")
    expect(row.attributes("aria-current")).toBeUndefined()
    expect(row.element.disabled).toBe(true)
    await row.trigger("click")
    expect(row.emitted("activate")).toHaveLength(1)
  })

  it("renders choice previews and icons without losing selection or disabled semantics", async () => {
    const plain = mount(UiChoiceCard, { props: { label: "C3" } })
    expect(plain.text()).toBe("C3")
    expect(plain.attributes("aria-pressed")).toBe("false")
    const choice = mount(UiChoiceCard, {
      props: { label: "C4", description: "Middle C", selected: true },
      slots: { preview: "Keyboard preview", icon: "Keyboard icon", trailing: "Selected" }
    })
    expect(choice.text()).toContain("Middle C")
    expect(choice.text()).toContain("Keyboard preview")
    expect(choice.text()).toContain("Keyboard icon")
    expect(choice.text()).toContain("Selected")
    expect(choice.attributes("aria-pressed")).toBe("true")
    await choice.trigger("click")
    expect(choice.emitted("select")).toEqual([[]])
    await choice.setProps({ selected: false, disabled: true, description: undefined })
    expect(choice.attributes("aria-pressed")).toBe("false")
    expect(choice.text()).not.toContain("Middle C")
    expect(choice.element.disabled).toBe(true)
    await choice.trigger("click")
    expect(choice.emitted("select")).toHaveLength(1)
  })

  it("edits multiline text, forwards ARIA and emits only explicit save shortcuts", async () => {
    const text = mount(UiTextarea, {
      attachTo: document.body,
      props: { modelValue: "First\nSecond", invalid: true },
      attrs: { "aria-label": "Notes", rows: 5 }
    })
    const input = text.get("textarea")
    expect(input.attributes()).toMatchObject({
      "aria-label": "Notes",
      "aria-invalid": "true",
      rows: "5"
    })
    await input.setValue("New first\nNew second")
    expect(text.emitted("update:modelValue")).toEqual([["New first\nNew second"]])
    await input.trigger("keydown", { key: "s" })
    expect(text.emitted("submitShortcut")).toBeUndefined()
    await input.trigger("keydown", { key: "s", ctrlKey: true })
    await input.trigger("keydown", { key: "S", metaKey: true })
    expect(text.emitted("submitShortcut")).toEqual([[], []])
    text.vm.focus()
    expect(document.activeElement).toBe(input.element)
    await text.setProps({ invalid: false })
    expect(input.attributes("aria-invalid")).toBeUndefined()
  })

  it("updates colors as strings and disables the native picker", async () => {
    const color = mount(UiColorInput, {
      props: { label: "Track color", modelValue: UI_DOMAIN_COLORS.audioChannel },
      attrs: { name: "track-color" }
    })
    await color.get("input").setValue(UI_DOMAIN_COLORS.busChannel.toLowerCase())
    expect(color.emitted("update:modelValue")).toEqual([
      [UI_DOMAIN_COLORS.busChannel.toLowerCase()]
    ])
    expect(color.attributes()).toMatchObject({
      "aria-label": "Track color",
      name: "track-color",
      type: "color"
    })
    await color.setProps({ disabled: true })
    expect(color.get("input").element.disabled).toBe(true)
  })

  it("prevents native form navigation and sends a payload-free submit intent", async () => {
    const form = mount(UiForm, { slots: { default: "Save project" } })
    const event = new Event("submit", { bubbles: true, cancelable: true })
    form.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(form.emitted("submit")).toEqual([[]])
  })

  it("switches tab panels and preserves disabled tabs", async () => {
    const tabs = mount(UiTabs, {
      attachTo: document.body,
      props: {
        label: "Editor",
        modelValue: "notes",
        items: [
          { id: "notes", label: "Notes", badge: "2" },
          { id: "files", label: "Files" },
          { id: "locked", label: "Locked", disabled: true }
        ]
      },
      slots: {
        notes: "<section>Notes content</section>",
        files: "<section>Files content</section>",
        locked: "<section>Locked content</section>"
      }
    })
    expect(tabs.get('[role="tab"][data-state="active"]').text()).toContain("Notes")
    await tabs.findAll('[role="tab"]')[1]!.trigger("mousedown", { button: 0 })
    expect(tabs.emitted("update:modelValue")).toEqual([["files"]])
    await tabs.setProps({ modelValue: "files" })
    expect(tabs.get('[role="tabpanel"]').text()).toBe("Files content")
    expect(tabs.findAll('[role="tab"]')[2]!.attributes("disabled")).toBeDefined()
  })

  it("navigates enabled settings categories and pages with persistent current state", async () => {
    const settings = mount(UiSettingsNavigator, {
      props: {
        modelValue: "unknown",
        title: "Preferences",
        scopeLabel: "Application",
        backLabel: "Back",
        categoriesLabel: "Categories",
        pagesLabel: "Pages",
        buildLabel: "0.4.7",
        categories: [
          {
            id: "audio",
            label: "Audio",
            description: "Audio configuration",
            badge: "2",
            items: [
              { id: "backend", label: "Backend", description: "Choose driver" },
              { id: "device", label: "Device", badge: "New" },
              { id: "locked", label: "Locked", disabled: true }
            ]
          },
          {
            id: "midi",
            label: "MIDI",
            items: [
              { id: "unavailable", label: "Unavailable", disabled: true },
              { id: "profiles", label: "Profiles" }
            ]
          },
          { id: "empty", label: "Empty", items: [] },
          {
            id: "disabled",
            label: "Disabled",
            disabled: true,
            items: [{ id: "hidden", label: "Hidden" }]
          }
        ]
      },
      slots: {
        "category-icon": "<span>Category icon</span>",
        "item-icon": "<span>Page icon</span>",
        actions: "Actions",
        default: "Page content"
      }
    })
    const categories = settings.get('nav[aria-label="Categories"]').findAll("button")
    expect(categories[0]!.attributes("aria-current")).toBe("page")
    expect(categories[2]!.attributes("disabled")).toBeDefined()
    expect(categories[3]!.attributes("disabled")).toBeDefined()
    await settings.get('nav[aria-label="Pages"]').findAll("button")[1]!.trigger("click")
    expect(settings.emitted("update:modelValue")?.at(-1)).toEqual(["device"])
    await settings.setProps({ modelValue: "device" })
    expect(settings.get('nav[aria-label="Pages"] [aria-current="page"]').text()).toContain("Device")
    await categories[1]!.trigger("click")
    expect(settings.emitted("update:modelValue")?.at(-1)).toEqual(["profiles"])
    await settings.setProps({ modelValue: "profiles" })
    expect(settings.get('nav[aria-label="Categories"] [aria-current="page"]').text()).toContain(
      "MIDI"
    )
    await settings.get('[aria-label="Back"]').trigger("click")
    expect(settings.emitted("back")).toEqual([[]])
    await settings.setProps({ categories: [] })
    expect(settings.find('nav[aria-label="Pages"]').exists()).toBe(false)
  })

  it.each(["timeline", "track-height", "waveform"] as const)(
    "shows %s zoom context and emits numeric zoom/reset intents",
    async (visual) => {
      const zoom = mount(UiZoomControl, {
        props: { modelValue: 50, label: "Zoom", resetLabel: "Reset zoom", visual, valueText: "50%" }
      })
      expect(zoom.find("svg path").exists()).toBe(true)
      const slider = zoom.get("input")
      expect(slider.attributes("aria-valuetext")).toBe("50%")
      await slider.setValue("75")
      expect(zoom.emitted("update:modelValue")).toEqual([[75]])
      await slider.trigger("dblclick")
      await zoom.get('button[aria-label="Reset zoom"]').trigger("click")
      expect(zoom.emitted("reset")).toEqual([[], []])
      await zoom.setProps({ disabled: true, min: 50, max: 50 })
      expect(slider.attributes("style")).toContain("--zoom-fill: 0%")
      expect(slider.element.disabled).toBe(true)
      await slider.trigger("dblclick")
      expect(zoom.emitted("reset")).toHaveLength(2)
    }
  )

  it("emits window commands without relying on Electron", async () => {
    const chrome = mount(UiWindowControls, {
      props: {
        label: "Window",
        minimizeLabel: "Minimize",
        maximizeLabel: "Maximize",
        closeLabel: "Close",
        minimizeCommand: "min",
        maximizeCommand: "max",
        closeCommand: "close"
      }
    })
    for (const label of ["Minimize", "Maximize", "Close"])
      await chrome.get(`[aria-label="${label}"]`).trigger("click")
    expect(chrome.emitted("command")).toEqual([["min"], ["max"], ["close"]])
  })

  it("selects mixer slots while preserving selected state and compact state-button intent", async () => {
    const slot = mount(UiMixerSlot, {
      props: { label: "Audio 1", selected: true },
      slots: { default: "Channel" }
    })
    await slot.trigger("pointerdown")
    expect(slot.emitted("select")).toEqual([[]])
    expect(slot.attributes("aria-current")).toBe("true")
    const button = mount(UiMixerStateButton, {
      props: { label: "Mute", size: "track", pressed: true, stopPropagation: true }
    })
    await button.trigger("click")
    expect(button.emitted("click")).toEqual([[]])
    expect(button.attributes("aria-pressed")).toBe("true")
    await button.setProps({ stopPropagation: false, pressed: false })
    await button.trigger("click")
    expect(button.emitted("click")).toHaveLength(2)
  })

  it("stops child controls selecting their enclosing surface and keeps pressed icons clickable", async () => {
    const container = document.createElement("div")
    const parentClick = vi.fn(),
      parentPointer = vi.fn()
    container.addEventListener("click", parentClick)
    container.addEventListener("pointerdown", parentPointer)
    const button = mount(UiButton, { attachTo: container, props: { stopPropagation: true } })
    await button.trigger("pointerdown")
    await button.trigger("click")
    expect(button.emitted("click")).toHaveLength(1)
    expect(parentClick).not.toHaveBeenCalled()
    expect(parentPointer).not.toHaveBeenCalled()
    await button.setProps({ stopPropagation: false })
    await button.trigger("pointerdown")
    await button.trigger("click")
    expect(parentClick).toHaveBeenCalledOnce()
    expect(parentPointer).toHaveBeenCalledOnce()
    const icon = mount(UiIconButton, {
      props: {
        label: "Low latency",
        appearance: "workspace",
        pressedTone: "success",
        pressed: true
      }
    })
    await icon.get("button").trigger("click")
    expect(icon.emitted("click")).toHaveLength(1)
    expect(icon.get("button").attributes("aria-pressed")).toBe("true")
  })
})
