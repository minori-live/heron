import { afterEach, describe, expect, it } from "vitest"
import { setAppLocale } from "../i18n"
import { pluginCompatibilityMessage } from "./pluginCompatibility"

afterEach(() => setAppLocale("en-US"))

describe("plug-in compatibility presentation", () => {
  it("localizes cached Heron fallback reasons while preserving external diagnostics", () => {
    const cached = "Plugin initialization failed"
    expect(pluginCompatibilityMessage(cached)).toBe(cached)
    setAppLocale("zh-cmn-Hans-CN")
    expect(pluginCompatibilityMessage(cached)).toBe("插件初始化失败。")
    expect(pluginCompatibilityMessage("Vendor error: license unavailable")).toBe(
      "Vendor error: license unavailable"
    )
    expect(pluginCompatibilityMessage(null)).not.toMatch(/[a-z]/iu)
  })
})
