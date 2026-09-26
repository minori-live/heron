import { enableAutoUnmount, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, describe, expect, it } from "vitest"
import { nextTick } from "vue"
import { useStudioWorkspaceStore } from "../../stores/studioWorkspace"
import WorkspaceSidePanel from "../workspace/WorkspaceSidePanel.vue"
import RightPanelHost from "./RightPanelHost.vue"

enableAutoUnmount(afterEach)

describe("RightPanelHost", () => {
  it("shares the panel interaction while preserving Studio persistence and content selection", async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = useStudioWorkspaceStore()
    workspace.toggleMediaBrowser()
    const wrapper = mount(RightPanelHost, {
      global: { plugins: [pinia], stubs: { MediaBrowserPanel: true, NotesPanel: true } }
    })
    const panel = wrapper.getComponent(WorkspaceSidePanel)
    expect(panel.props()).toMatchObject({
      modelValue: 320,
      minimum: 260,
      maximum: 480,
      defaultWidth: 320
    })
    expect(wrapper.find("media-browser-panel-stub").exists()).toBe(true)
    const separator = wrapper.get('[role="separator"]')
    await separator.trigger("keydown", { key: "ArrowLeft" })
    expect(workspace.rightPanelWidth).toBe(330)
    expect(wrapper.attributes("style")).toContain("width: 330px")
    workspace.toggleNotesPanel()
    await nextTick()
    expect(wrapper.find("notes-panel-stub").exists()).toBe(true)
    expect(wrapper.find("media-browser-panel-stub").exists()).toBe(false)
    expect(workspace.rightPanelWidth).toBe(330)
    await separator.trigger("keydown", { key: "Home" })
    expect(workspace.rightPanelWidth).toBe(320)
    workspace.setRightPanelWidth(600)
    await nextTick()
    expect(panel.props("modelValue")).toBe(480)
  })
})
