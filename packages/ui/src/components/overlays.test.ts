import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, describe, expect, it } from "vitest"
import { h } from "vue"

import UiAlertDialog from "./UiAlertDialog.vue"
import UiDialog from "./UiDialog.vue"
import UiIconButton from "./UiIconButton.vue"
import UiMenubar from "./UiMenubar.vue"
import UiPopover from "./UiPopover.vue"
import UiProvider from "./UiProvider.vue"
import UiTooltip from "./UiTooltip.vue"

// Overlays teleport into `document.body` and keep listeners there, so every
// wrapper has to be torn down before the next test inspects the document.
enableAutoUnmount(afterEach)

/** Overlay content is portalled to `document.body`, outside the wrapper element. */
function portal(selector: string): DOMWrapper<HTMLElement> {
  return new DOMWrapper(document.body.querySelector<HTMLElement>(selector))
}

function portalAll(selector: string): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(selector)]
}

describe("UiDialog", () => {
  it("renders title, description, body, and actions when open", async () => {
    mount(UiDialog, {
      attachTo: document.body,
      props: {
        modelValue: true,
        eyebrow: "Project",
        title: "Unsaved changes",
        description: "Save before closing?"
      },
      slots: {
        default: "<p>Three tracks changed.</p>",
        actions: '<button type="button">Save</button>'
      }
    })
    await flushPromises()

    const dialog = portal('[role="dialog"]')
    expect(dialog.get("h2").text()).toBe("Unsaved changes")
    expect(dialog.text()).toContain("Project")
    expect(dialog.text()).toContain("Save before closing?")
    expect(dialog.text()).toContain("Three tracks changed.")
    expect(dialog.findAll("button").map((button) => button.text())).toContain("Save")
  })

  it("stays closed until the model opens it", async () => {
    const wrapper = mount(UiDialog, {
      attachTo: document.body,
      props: { modelValue: false, title: "Export" }
    })
    await flushPromises()
    expect(document.body.querySelector(".ui-dialog")).toBeNull()

    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(document.body.querySelector(".ui-dialog")).not.toBeNull()
  })

  it("applies the requested size and omits an empty actions footer", async () => {
    mount(UiDialog, {
      attachTo: document.body,
      props: { modelValue: true, title: "Export", size: "lg" }
    })
    await flushPromises()

    expect(portal('[role="dialog"]').attributes("data-size")).toBe("lg")
    expect(portal('[role="dialog"]').findAll("footer")).toHaveLength(0)
  })

  it("offers a labelled close affordance that clears the model", async () => {
    const wrapper = mount(UiDialog, {
      attachTo: document.body,
      props: { modelValue: true, title: "Export", closeLabel: "Dismiss export" }
    })
    await flushPromises()

    const close = portal('[aria-label="Dismiss export"]')
    expect(close.attributes("aria-label")).toBe("Dismiss export")
    await close.trigger("click")
    await flushPromises()

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false])
  })

  it("hides the close button for non-dismissible dialogs", async () => {
    mount(UiDialog, {
      attachTo: document.body,
      props: { modelValue: true, title: "Migrating project", dismissible: false }
    })
    await flushPromises()

    expect(document.body.querySelector('[aria-label="Close dialog"]')).toBeNull()
    expect(document.body.querySelector('[data-dialog-part="close-slot"]')).toBeNull()
  })

  it("can reserve stable header space while the close button is unavailable", async () => {
    const wrapper = mount(UiDialog, {
      attachTo: document.body,
      props: {
        modelValue: true,
        title: "Migrating project",
        dismissible: false,
        reserveCloseSpace: true
      }
    })
    await flushPromises()

    expect(document.body.querySelector('[aria-label="Close dialog"]')).toBeNull()

    await wrapper.setProps({ dismissible: true })
    await flushPromises()

    expect(document.body.querySelector('[aria-label="Close dialog"]')).not.toBeNull()
  })

  it("replaces the default heading with a header slot", async () => {
    mount(UiDialog, {
      attachTo: document.body,
      props: { modelValue: true, title: "Ignored" },
      slots: { header: '<h2 class="custom-heading">Custom</h2>' }
    })
    await flushPromises()

    expect(portal('[role="dialog"]').findAll("h2")).toHaveLength(1)
    expect(portal('[role="dialog"]').text()).toContain("Custom")
  })

  it("opens from a trigger slot", async () => {
    const wrapper = mount(UiDialog, {
      attachTo: document.body,
      props: { modelValue: false, title: "Export" },
      slots: { trigger: '<button type="button">Open</button>' }
    })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([true])
  })
})

describe("UiAlertDialog", () => {
  it("emits confirm and cancel from the default buttons", async () => {
    const wrapper = mount(UiAlertDialog, {
      attachTo: document.body,
      props: { modelValue: true, title: "Discard?", description: "Unsaved take." }
    })
    await flushPromises()

    const [cancel, confirm] = portalAll("button")
    await new DOMWrapper(cancel).trigger("click")
    expect(wrapper.emitted("cancel")).toHaveLength(1)

    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await new DOMWrapper(portalAll("button")[1] ?? confirm).trigger("click")
    expect(wrapper.emitted("confirm")).toHaveLength(1)
  })

  it("tones the confirm button and the content for destructive prompts", async () => {
    mount(UiAlertDialog, {
      attachTo: document.body,
      props: {
        modelValue: true,
        title: "Delete take?",
        description: "This cannot be undone.",
        tone: "danger",
        confirmLabel: "Delete",
        cancelLabel: "Keep"
      }
    })
    await flushPromises()

    expect(portal(".ui-alert-dialog").attributes("data-tone")).toBe("danger")
    const buttons = portalAll("button")
    expect(buttons[0]?.textContent?.trim()).toBe("Keep")
    expect(buttons[1]?.textContent?.trim()).toBe("Delete")
  })

  it("renders custom actions and reports the chosen value", async () => {
    const wrapper = mount(UiAlertDialog, {
      attachTo: document.body,
      props: {
        modelValue: true,
        title: "Close project?",
        description: "Three tracks changed.",
        actions: [
          { value: "save", label: "Save" },
          { value: "discard", label: "Discard", variant: "danger" },
          { value: "cancel", label: "Cancel", cancel: true }
        ]
      }
    })
    await flushPromises()

    const buttons = portalAll("button")
    expect(buttons.map((node) => node.textContent?.trim())).toEqual(["Save", "Discard", "Cancel"])

    await new DOMWrapper(buttons[1]).trigger("click")
    expect(wrapper.emitted("action")).toEqual([["discard"]])
  })

  it("disables every action while busy", async () => {
    mount(UiAlertDialog, {
      attachTo: document.body,
      props: {
        modelValue: true,
        title: "Saving",
        description: "Writing the archive.",
        busy: true
      }
    })
    await flushPromises()

    for (const button of portalAll("button")) {
      expect(button.hasAttribute("disabled")).toBe(true)
    }
  })

  it("shows an eyebrow and detail slot when supplied", async () => {
    mount(UiAlertDialog, {
      attachTo: document.body,
      props: {
        modelValue: true,
        eyebrow: "Recording",
        title: "Recover take?",
        description: "A take was left behind."
      },
      slots: { default: "<ul><li>take-01.wav</li></ul>" }
    })
    await flushPromises()

    expect(portal('[role="alertdialog"]').text()).toContain("Recording")
    expect(portal('[role="alertdialog"]').text()).toContain("take-01.wav")
  })
})

describe("UiPopover", () => {
  it("requests an open state when the trigger is activated", async () => {
    const wrapper = mount(UiPopover, {
      attachTo: document.body,
      props: { modelValue: false },
      slots: {
        trigger: '<button type="button">Performance</button>',
        default: "<p>CPU 12%</p>"
      }
    })

    await wrapper.get("button").trigger("click")

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([true])
  })
})

describe("UiTooltip", () => {
  it("shows the tooltip text and shortcut on focus", async () => {
    mount(UiProvider, {
      attachTo: document.body,
      props: { tooltipDelay: 0 },
      slots: {
        default: () =>
          h(UiTooltip, { text: "Play", shortcut: "Space" }, () =>
            h("button", { type: "button" }, "▶")
          )
      }
    })

    await new DOMWrapper(document.body.querySelector<HTMLElement>("button")).trigger("focus")
    await flushPromises()

    const tooltip = portal('[data-ui-part="tooltip-content"]')
    expect(tooltip.text()).toContain("Play")
    expect(tooltip.get("kbd").text()).toBe("Space")
  })

  it("omits the shortcut key when none is supplied", async () => {
    mount(UiProvider, {
      attachTo: document.body,
      props: { tooltipDelay: 0 },
      slots: {
        default: () => h(UiTooltip, { text: "Play" }, () => h("button", { type: "button" }, "▶"))
      }
    })

    await new DOMWrapper(document.body.querySelector<HTMLElement>("button")).trigger("focus")
    await flushPromises()

    const tooltip = portal('[data-ui-part="tooltip-content"]')
    expect(tooltip.text()).toContain("Play")
    expect(tooltip.find("kbd").exists()).toBe(false)
  })

  it("stays hidden when disabled", async () => {
    mount(UiProvider, {
      attachTo: document.body,
      props: { tooltipDelay: 0 },
      slots: {
        default: () =>
          h(UiTooltip, { text: "Play", disabled: true }, () => h("button", { type: "button" }, "▶"))
      }
    })

    await new DOMWrapper(document.body.querySelector<HTMLElement>("button")).trigger("focus")
    await flushPromises()

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })
})

describe("UiIconButton", () => {
  it("labels an icon-only button for assistive technology", () => {
    const wrapper = mount(UiProvider, {
      attachTo: document.body,
      slots: {
        default: () => h(UiIconButton, { label: "Toggle metronome" }, () => h("span", "M"))
      }
    })

    const button = wrapper.get("button")
    expect(button.attributes("aria-label")).toBe("Toggle metronome")
    expect(button.text()).toBe("M")
  })

  it("exposes a toggle state and honors the disabled prop", () => {
    const wrapper = mount(UiProvider, {
      attachTo: document.body,
      slots: {
        default: () =>
          h(UiIconButton, {
            label: "Toggle metronome",
            pressed: true,
            disabled: true,
            size: "sm",
            variant: "secondary"
          })
      }
    })

    const button = wrapper.get("button")
    expect(button.attributes("aria-pressed")).toBe("true")
    expect(button.attributes("disabled")).toBeDefined()
    expect(button.attributes("data-size")).toBe("sm")
    expect(button.attributes("data-variant")).toBe("secondary")
  })
})

describe("UiMenubar", () => {
  it("renders one trigger per menu", () => {
    const wrapper = mount(UiMenubar, {
      attachTo: document.body,
      props: {
        ariaLabel: "Main menu",
        menus: [
          { value: "file", label: "File", items: [{ value: "file.new", label: "New" }] },
          { value: "edit", label: "Edit", items: [{ value: "edit.undo", label: "Undo" }] }
        ]
      }
    })

    expect(wrapper.attributes("aria-label")).toBe("Main menu")
    expect(
      wrapper.findAll('[role="menubar"] [role="menuitem"]').map((item) => item.text())
    ).toEqual(["File", "Edit"])
  })

  it("shows items, shortcuts, separators, and reports the selected value", async () => {
    const wrapper = mount(UiMenubar, {
      attachTo: document.body,
      props: {
        menus: [
          {
            value: "file",
            label: "File",
            items: [
              { value: "file.new", label: "New project", shortcut: "Ctrl+N" },
              { value: "file.close", label: "Close", separatorBefore: true, disabled: true }
            ]
          }
        ]
      }
    })

    await wrapper.get('[role="menubar"] [role="menuitem"]').trigger("pointerdown", { button: 0 })
    await flushPromises()

    const items = portalAll('[role="menu"] [role="menuitem"]')
    expect(items.map((item) => item.querySelector("span")?.textContent)).toEqual([
      "New project",
      "Close"
    ])
    expect(items[0]?.querySelector("kbd")?.textContent?.trim()).toBe("Ctrl+N")
    expect(items[1]?.querySelector("kbd")).toBeNull()
    expect(document.body.querySelector('[role="separator"]')).not.toBeNull()
    expect(items[1]?.hasAttribute("data-disabled")).toBe(true)

    await new DOMWrapper(items[0]).trigger("click")
    await flushPromises()
    expect(wrapper.emitted("select")).toEqual([["file.new"]])
  })
})
