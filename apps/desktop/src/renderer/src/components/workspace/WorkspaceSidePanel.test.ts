import { enableAutoUnmount, mount } from "@vue/test-utils"
import { shallowRef } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import WorkspaceSidePanel from "./WorkspaceSidePanel.vue"

enableAutoUnmount(afterEach)

function mountPanel(initialWidth = 320, minimum = 260, maximum = 480) {
  const requestedWidth = shallowRef(initialWidth)
  const wrapper = mount(WorkspaceSidePanel, {
    props: {
      modelValue: requestedWidth.value,
      label: "Workspace panel",
      resizeLabel: "Resize workspace panel",
      minimum,
      maximum,
      defaultWidth: initialWidth,
      "onUpdate:modelValue": (value: number): void => {
        requestedWidth.value = value
        void wrapper.setProps({ modelValue: value })
      }
    },
    slots: { default: "Panel content" }
  })
  return { wrapper, requestedWidth, separator: wrapper.get<HTMLElement>('[role="separator"]') }
}

describe("WorkspaceSidePanel", () => {
  it("bounds repeated keyboard resizes and resets through Home or double-click", async () => {
    const { wrapper, requestedWidth, separator } = mountPanel()
    expect(wrapper.attributes("aria-label")).toBe("Workspace panel")
    expect(wrapper.text()).toContain("Panel content")
    expect(separator.attributes("aria-valuemin")).toBe("260")
    expect(separator.attributes("aria-valuemax")).toBe("480")
    await separator.trigger("keydown", { key: "ArrowLeft" })
    await separator.trigger("keydown", { key: "ArrowLeft" })
    expect(requestedWidth.value).toBe(340)
    await separator.trigger("keydown", { key: "ArrowRight" })
    expect(requestedWidth.value).toBe(330)
    for (let index = 0; index < 20; index++) {
      await separator.trigger("keydown", { key: "ArrowRight" })
    }
    expect(requestedWidth.value).toBe(260)
    expect(separator.attributes("aria-valuenow")).toBe("260")
    await separator.trigger("keydown", { key: "Home" })
    expect(requestedWidth.value).toBe(320)
    await separator.trigger("keydown", { key: "ArrowLeft" })
    await separator.trigger("dblclick")
    expect(requestedWidth.value).toBe(320)
  })

  it("captures a drag, commits once from its origin, and ignores released pointers", async () => {
    const { requestedWidth, separator } = mountPanel()
    const capture = vi.fn()
    separator.element.setPointerCapture = capture
    await separator.trigger("pointerdown", { button: 0, pointerId: 7, clientX: 680 })
    expect(capture).toHaveBeenCalledWith(7)
    await separator.trigger("pointermove", { pointerId: 7, clientX: 600 })
    expect(requestedWidth.value).toBe(400)
    await separator.trigger("pointermove", { pointerId: 7, clientX: 300 })
    expect(requestedWidth.value).toBe(480)
    await separator.trigger("pointerup", { pointerId: 7, clientX: 600 })
    expect(requestedWidth.value).toBe(400)
    await separator.trigger("pointermove", { pointerId: 7, clientX: 700 })
    expect(requestedWidth.value).toBe(400)
  })

  it("restores the caller's requested width on Escape without committing pointer-up", async () => {
    const { wrapper, requestedWidth, separator } = mountPanel(520, 360, 440)
    expect(wrapper.attributes("style")).toContain("width: 440px")
    await separator.trigger("pointerdown", { button: 0, pointerId: 1, clientX: 680 })
    await separator.trigger("pointermove", { pointerId: 1, clientX: 720 })
    expect(requestedWidth.value).toBe(400)
    await separator.trigger("keydown", { key: "Escape" })
    expect(requestedWidth.value).toBe(520)
    expect(wrapper.attributes("style")).toContain("width: 440px")
    await separator.trigger("pointerup", { pointerId: 1, clientX: 720 })
    expect(requestedWidth.value).toBe(520)
  })

  it("adapts to responsive limits without overwriting the caller's width preference", async () => {
    const { wrapper, requestedWidth, separator } = mountPanel(520, 360, 900)
    expect(wrapper.attributes("style")).toContain("width: 520px")
    await wrapper.setProps({ maximum: 400 })
    expect(wrapper.attributes("style")).toContain("width: 400px")
    expect(separator.attributes("aria-valuenow")).toBe("400")
    expect(requestedWidth.value).toBe(520)
    expect(wrapper.emitted("update:modelValue")).toBeUndefined()
    await wrapper.setProps({ maximum: 900 })
    expect(wrapper.attributes("style")).toContain("width: 520px")
    expect(requestedWidth.value).toBe(520)
  })
})
