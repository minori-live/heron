import { afterEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import type { LiveEditCommand, LiveHierarchy } from "@heron/contracts"
import LiveProjectPanel from "./LiveProjectPanel.vue"
import { i18n } from "../../i18n"

const t = i18n.global.t
const hierarchy: LiveHierarchy = {
  sets: [
    {
      id: "set",
      name: "Acoustic",
      sortOrder: 0,
      overrides: [{ type: "channel", id: "voice", parameter: "gainDb", value: -6 }]
    }
  ],
  patches: [
    {
      id: "patch",
      setId: "set",
      name: "Opening",
      sortOrder: 0,
      overrides: [{ type: "channel", id: "voice", parameter: "pan", value: 0.2 }]
    }
  ]
}
const wrappers: ReturnType<typeof mount>[] = []
function fixture(selectedLayerId: string | null = null) {
  const edit =
    vi.fn<
      (
        command: LiveEditCommand,
        selection: string | null,
        settle: (committed: boolean) => void
      ) => void
    >()
  const wrapper = mount(LiveProjectPanel, {
    attachTo: document.body,
    props: {
      name: "Stage",
      pending: false,
      error: "",
      hierarchy,
      selectedLayerId,
      onEditLayer: edit
    }
  })
  wrappers.push(wrapper)
  return { wrapper, edit }
}
function click(label: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label
  )
  if (!button) throw new Error(`Missing button ${label}`)
  button.click()
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe("Live layer navigation", () => {
  it("separates selection from document edits and retains failed creation drafts", async () => {
    const { wrapper, edit } = fixture()
    await wrapper.findAll("nav button")[2]!.trigger("click")
    expect(wrapper.emitted("selectLayer")).toEqual([["patch"]])
    expect(edit).not.toHaveBeenCalled()
    click(t("live.layers.createPatch"))
    await flushPromises()
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
    input.value = "Chorus"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await flushPromises()
    document
      .querySelector<HTMLFormElement>('[role="dialog"] form')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    expect(edit.mock.calls[0]?.[0]).toEqual({
      type: "create-patch",
      patchId: expect.any(String),
      setId: "set",
      name: "Chorus"
    })
    expect(edit.mock.calls[0]?.[1]).toBe((edit.mock.calls[0]![0] as { patchId: string }).patchId)
    edit.mock.calls[0]![2](false)
    await wrapper.setProps({ error: "Revision conflict", blocked: true })
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(
      "Revision conflict"
    )
    expect(input.value).toBe("Chorus")
    expect(
      document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')?.disabled
    ).toBe(true)
    expect(
      document.querySelector<HTMLButtonElement>(
        `[role="dialog"] button[aria-label="${t("dialog.actions.cancel")}"]`
      )?.disabled
    ).toBe(false)
    edit.mock.calls[0]![2](true)
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("previews Set deletion impact and commits only after explicit confirmation", async () => {
    const { edit } = fixture("set")
    click(t("live.layers.delete"))
    await flushPromises()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain(
      t("live.layers.deleteImpact", { name: "Acoustic", patches: 1, overrides: 2 })
    )
    expect(dialog.textContent).toContain("Opening")
    expect(edit).not.toHaveBeenCalled()
    dialog
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    expect(edit).toHaveBeenCalledWith(
      { type: "delete-live-layer", layerId: "set" },
      null,
      expect.any(Function)
    )
  })

  it("copies a Patch to an explicit destination Set with a fresh identity", async () => {
    const { wrapper, edit } = fixture("patch")
    await wrapper.setProps({
      hierarchy: {
        ...hierarchy,
        sets: [...hierarchy.sets, { id: "encore", name: "Encore", sortOrder: 1, overrides: [] }]
      }
    })
    click(t("live.layers.copy"))
    await flushPromises()
    const select = document.querySelector<HTMLSelectElement>('[role="dialog"] select')!
    select.value = "encore"
    select.dispatchEvent(new Event("change", { bubbles: true }))
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      t("live.layers.crossSetCopy")
    )
    document
      .querySelector<HTMLFormElement>('[role="dialog"] form')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    expect(edit.mock.calls[0]?.[0]).toMatchObject({
      type: "copy-live-patch",
      sourceId: "patch",
      setId: "encore",
      patchId: expect.any(String)
    })
    expect((edit.mock.calls[0]![0] as { patchId: string }).patchId).not.toBe("patch")
  })
})
