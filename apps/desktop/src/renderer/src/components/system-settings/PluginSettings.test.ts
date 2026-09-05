import { mount } from "@vue/test-utils"
import { afterEach, describe, expect, it } from "vitest"
import { i18n } from "../../i18n"
import type { PluginDescriptor } from "@heron/contracts"
import PluginSettings from "./PluginSettings.vue"

function plugin(
  name: string,
  kind: PluginDescriptor["kind"],
  compatibility: PluginDescriptor["compatibility"]
): PluginDescriptor {
  return {
    source: { kind: "external" },
    locator: { format: "vst3", artifactPath: `/${name}.vst3`, nativeId: name },
    name,
    vendor: "Acme Audio",
    version: "1",
    categories: [],
    kind,
    supportedAudioModes: ["stereo"],
    architecture: "arm64",
    buses: [],
    hasEditor: true,
    compatibility,
    compatibilityReason: compatibility === "compatible" ? null : "Unavailable"
  }
}

describe("PluginSettings", () => {
  afterEach(() => {
    i18n.global.locale.value = "en-US"
  })

  it("formats a completed scan in Chinese without rejecting the stored locale", () => {
    i18n.global.locale.value = "zh-cmn-Hans-CN"
    const scannedAt = new Date(2026, 8, 6, 12, 30).getTime()
    const wrapper = mount(PluginSettings, {
      props: {
        catalog: { scannerVersion: 7, scanning: false, scannedAt, plugins: [] },
        scanProgress: null,
        loading: false,
        error: ""
      }
    })
    expect(wrapper.text()).toContain(
      new Intl.DateTimeFormat("zh-Hans-CN", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(scannedAt)
    )
    wrapper.unmount()
  })

  it("summarizes the catalog and emits a manual rescan", async () => {
    const wrapper = mount(PluginSettings, {
      props: {
        catalog: {
          scannerVersion: 7,
          scanning: false,
          scannedAt: null,
          plugins: [
            plugin("Delay", "effect", "compatible"),
            plugin("Synth", "instrument", "compatible"),
            plugin("Broken", "effect", "quarantined")
          ]
        },
        scanProgress: null,
        loading: false,
        error: ""
      }
    })

    expect(wrapper.text()).toContain("Compatible effects")
    expect(wrapper.text()).toContain("Compatible instruments")
    expect(wrapper.text()).toContain("Not scanned yet")
    await wrapper.get("button").trigger("click")
    expect(wrapper.emitted("rescan")).toHaveLength(1)
  })

  it("disables rescanning and reports progress while a scan is running", () => {
    const wrapper = mount(PluginSettings, {
      props: {
        catalog: { scannerVersion: 7, scanning: true, scannedAt: null, plugins: [] },
        scanProgress: { completed: 2, total: 5, path: "/Library/Audio/Plug-Ins/VST3" },
        loading: false,
        error: ""
      }
    })

    expect(wrapper.get("button").attributes("disabled")).toBeDefined()
    expect(wrapper.get('[role="status"]').text()).toContain("2 of 5")
  })
})
