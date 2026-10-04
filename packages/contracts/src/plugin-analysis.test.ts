import { describe, expect, it } from "vitest"
import { DEFAULT_PLUGIN_ANALYSIS_SETTINGS, validPluginAnalysisSettings } from "./plugin-analysis.ts"

describe("Plugin Analysis settings validation", () => {
  it("accepts the shipped sweep and supported floating-point excitation limits", () => {
    expect(validPluginAnalysisSettings(DEFAULT_PLUGIN_ANALYSIS_SETTINGS)).toBe(true)
    expect(
      validPluginAnalysisSettings({
        sample_rate: 44_100,
        block_size: 64,
        level_dbfs: -60,
        start_hz: 10,
        end_hz: 19_845,
        sweep_seconds: 1,
        tail_seconds: 0.25
      })
    ).toBe(true)
    expect(
      validPluginAnalysisSettings({
        sample_rate: 96_000,
        block_size: 1024,
        level_dbfs: 12,
        start_hz: 20,
        end_hz: 43_200,
        sweep_seconds: 8,
        tail_seconds: 5
      })
    ).toBe(true)
  })

  it("rejects incomplete or non-object IPC payloads", () => {
    for (const value of [undefined, null, false, "settings", 48_000, {}, []]) {
      expect(validPluginAnalysisSettings(value)).toBe(false)
    }
  })

  it.each([
    ["unsupported sample rate", { sample_rate: 192_000 }],
    ["unsupported block size", { block_size: 255 }],
    ["coerced numeric field", { level_dbfs: "-18" }],
    ["non-finite excitation", { level_dbfs: Number.NaN }],
    ["excitation below the measurement range", { level_dbfs: -60.01 }],
    ["excitation above the measurement range", { level_dbfs: 12.01 }],
    ["non-finite lower frequency", { start_hz: Number.POSITIVE_INFINITY }],
    ["subsonic lower frequency", { start_hz: 9.99 }],
    ["non-finite upper frequency", { end_hz: Number.POSITIVE_INFINITY }],
    ["band too narrow for measurement", { start_hz: 100, end_hz: 200 }],
    ["band above the anti-aliasing margin", { end_hz: 21_600.01 }],
    ["non-finite sweep duration", { sweep_seconds: Number.NaN }],
    ["sweep too short", { sweep_seconds: 0.99 }],
    ["sweep exceeding the work bound", { sweep_seconds: 8.01 }],
    ["non-finite tail duration", { tail_seconds: Number.POSITIVE_INFINITY }],
    ["tail too short to settle", { tail_seconds: 0.24 }],
    ["tail exceeding the work bound", { tail_seconds: 5.01 }]
  ])("rejects %s before native work starts", (_reason, patch) => {
    expect(validPluginAnalysisSettings({ ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, ...patch })).toBe(
      false
    )
  })

  it("checks the upper frequency against the selected sample rate", () => {
    const settings = { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS, sample_rate: 44_100 }
    expect(validPluginAnalysisSettings(settings)).toBe(false)
    expect(validPluginAnalysisSettings({ ...settings, end_hz: 19_845 })).toBe(true)
  })
})
