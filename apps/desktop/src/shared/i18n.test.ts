import { describe, expect, it } from "vitest"
import { APP_LOCALES, DEFAULT_LOCALE, intlLocale, isAppLocale, rekaLocale, translate } from "./i18n"

describe("shared i18n", () => {
  it("maps stored language identifiers to valid Intl locales", () => {
    expect(intlLocale("zh-cmn-Hans-CN")).toBe("zh-Hans-CN")
    expect(intlLocale("en-US")).toBe("en-US")
    for (const locale of APP_LOCALES) {
      expect(() => new Intl.DateTimeFormat(intlLocale(locale)).format(0)).not.toThrow()
      expect(() => new Intl.NumberFormat(intlLocale(locale)).format(1_000)).not.toThrow()
    }
  })

  it("validates supported locales", () => {
    expect(isAppLocale("en-US")).toBe(true)
    expect(isAppLocale("zh-cmn-Hans-CN")).toBe(true)
    expect(isAppLocale("zh-CN")).toBe(false)
    expect(DEFAULT_LOCALE).toBe("en-US")
  })

  it("resolves nested keys and interpolates params", () => {
    const messages = {
      startup: {
        foundBundles: "Found {count} VST3 bundles"
      }
    }
    expect(translate(messages, "startup.foundBundles", { count: 3 })).toBe("Found 3 VST3 bundles")
    expect(translate(messages, "missing.key")).toBe("missing.key")
  })

  it("maps app locales to Reka ConfigProvider locale tags", () => {
    expect(rekaLocale("en-US")).toBe("en")
    expect(rekaLocale("zh-cmn-Hans-CN")).toBe("zh")
  })
})
