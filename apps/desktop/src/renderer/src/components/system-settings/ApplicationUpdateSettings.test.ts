import { mount } from "@vue/test-utils"
import { createTestingPinia } from "@pinia/testing"
import { describe, expect, it, vi } from "vitest"
import ApplicationUpdateSettings from "./ApplicationUpdateSettings.vue"
import { useApplicationUpdatesStore } from "../../stores/applicationUpdates"

describe("ApplicationUpdateSettings", () => {
  it("shows disabled builds without update actions", () => {
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const store = useApplicationUpdatesStore(pinia)
    store.snapshot = {
      revision: 0,
      phase: "disabled",
      currentVersion: "1.0.0",
      channel: null,
      availableVersion: null,
      progress: 0,
      error: null
    }
    const wrapper = mount(ApplicationUpdateSettings, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain("Automatic updates are unavailable")
    expect(wrapper.findAll("button")).toHaveLength(0)
  })
  it("offers explicit installation only when the download is ready", async () => {
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const store = useApplicationUpdatesStore(pinia)
    store.snapshot = {
      revision: 2,
      phase: "ready",
      currentVersion: "1.0.0",
      channel: "latest",
      availableVersion: "1.1.0",
      progress: 100,
      error: null
    }
    const wrapper = mount(ApplicationUpdateSettings, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain("1.1.0 is ready")
    await wrapper.get("button").trigger("click")
    expect(store.install).toHaveBeenCalledOnce()
  })
})
