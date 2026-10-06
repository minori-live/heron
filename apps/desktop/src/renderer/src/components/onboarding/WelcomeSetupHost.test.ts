import { flushPromises, mount } from "@vue/test-utils"
import { createPinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ApplicationSettingsResourceSnapshot, RpcResult } from "@heron/contracts"
import WelcomeSetupHost from "./WelcomeSetupHost.vue"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useWelcomeSetupStore } from "../../stores/welcomeSetup"
import { rpcFailure, rpcSuccess, settingsSnapshot, stubApi, testSettings } from "../../test/ipc"

const initial = testSettings({ welcomeCompleted: false })
function setup() {
  const pinia = createPinia()
  const settings = useApplicationSettingsStore(pinia)
  settings.applySnapshot(settingsSnapshot(initial))
  const wrapper = mount(WelcomeSetupHost, { global: { plugins: [pinia] } })
  return { wrapper, settings, welcome: useWelcomeSetupStore(pinia) }
}

beforeEach(() => {
  stubApi({
    updateApplicationSettings: vi.fn(async (_meta, patch) =>
      rpcSuccess(settingsSnapshot(testSettings({ ...initial, ...patch }), 2))
    )
  })
})

describe("welcome setup", () => {
  it("keeps previews and consent local until Continue commits all choices together", async () => {
    const { wrapper, welcome, settings } = setup()
    const light = wrapper.findAll("button").find((button) => button.text().includes("Light"))!
    const chinese = wrapper.findAll("button").find((button) => button.text().includes("简体中文"))!
    await light.trigger("click")
    await chinese.trigger("click")
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(welcome.theme).toBe("light")
    expect(welcome.locale).toBe("zh-cmn-Hans-CN")
    expect(settings.settings?.diagnosticsEnabled).toBe(false)
    expect(window.heron.updateApplicationSettings).not.toHaveBeenCalled()
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Continue")!
      .trigger("click")
    await flushPromises()
    expect(window.heron.updateApplicationSettings).toHaveBeenCalledWith(expect.any(Object), {
      theme: "light",
      locale: "zh-cmn-Hans-CN",
      diagnosticsEnabled: true,
      welcomeCompleted: true
    })
    expect(welcome.required).toBe(false)
    wrapper.unmount()
  })

  it("keeps failed choices for retry and blocks duplicate saves while busy", async () => {
    let release: ((result: RpcResult<ApplicationSettingsResourceSnapshot>) => void) | undefined
    stubApi({
      updateApplicationSettings: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve
          })
      )
    })
    const { wrapper, settings, welcome } = setup()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    const next = wrapper.findAll("button").find((button) => button.text() === "Continue")!
    await next.trigger("click")
    await flushPromises()
    expect(next.attributes("disabled")).toBeDefined()
    await next.trigger("click")
    expect(window.heron.updateApplicationSettings).toHaveBeenCalledTimes(1)
    release!(rpcFailure("errors.operationFailed"))
    await flushPromises()
    expect(welcome.required).toBe(true)
    expect(settings.settings?.diagnosticsEnabled).toBe(false)
    expect(wrapper.get('input[type="checkbox"]').element).toHaveProperty("checked", true)
    expect(wrapper.get('[role="alert"]').text()).toContain("try again")
    stubApi({
      updateApplicationSettings: vi.fn(async (_meta, patch) =>
        rpcSuccess(settingsSnapshot(testSettings({ ...initial, ...patch }), 2))
      )
    })
    await next.trigger("click")
    await flushPromises()
    expect(welcome.required).toBe(false)
    expect(settings.settings?.diagnosticsEnabled).toBe(true)
    wrapper.unmount()
  })
})
