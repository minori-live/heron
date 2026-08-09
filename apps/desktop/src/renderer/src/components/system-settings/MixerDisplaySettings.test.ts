import { flushPromises, mount } from "@vue/test-utils"
import { createPinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_METER_RETURN_RATE, METER_RETURN_RATES } from "@heron/contracts"
import MixerDisplaySettings from "./MixerDisplaySettings.vue"
import { rpcSuccess, settingsSnapshot, testBootstrap, testSettings } from "../../test/ipc"

const settings = {
  swapDirectory: "C:/swap",
  recordingBitDepth: "float32" as const,
  theme: "dark" as const,
  locale: "en-US" as const,
  meterPeakHold: "800ms" as const,
  meterReturnRate: "iec-type-i" as const,
  midiCenterCStandard: "roland-c4" as const,
  recentProjects: []
}

describe("MixerDisplaySettings", () => {
  beforeEach(() => {
    window.heron.bootstrap = vi
      .fn()
      .mockResolvedValue(
        rpcSuccess(testBootstrap({ settings: settingsSnapshot(testSettings(settings)) }))
      )
    window.heron.updateApplicationSettings = vi
      .fn()
      .mockImplementation(async (_meta, patch) =>
        rpcSuccess(settingsSnapshot(testSettings({ ...settings, ...patch }), 2))
      )
  })

  it("persists meter display settings and orders return rates from slowest to fastest", async () => {
    const wrapper = mount(MixerDisplaySettings, {
      global: { plugins: [createPinia()] }
    })
    await flushPromises()

    const peakHold = wrapper.get('select[aria-label="Mixer meter peak hold time"]')
    await peakHold.setValue("4s")
    await flushPromises()

    expect(window.heron.updateApplicationSettings).toHaveBeenCalledWith(expect.any(Object), {
      meterPeakHold: "4s"
    })
    const returnTime = wrapper.get<HTMLSelectElement>(
      'select[aria-label="Mixer meter return time"]'
    )
    const options = returnTime.findAll("option")
    expect(options.map((option) => option.attributes("value"))).toEqual([...METER_RETURN_RATES])
    expect(options.map((option) => option.text())).toEqual([
      "Very Slow (4 dB/s)",
      "EBU Slow (6.3 dB/s)",
      "IEC Type II/EBU (8.6 dB/s)",
      "IEC Type I (11.8 dB/s)",
      "Fast (20 dB/s)",
      "Faster (30 dB/s)",
      "Very Fast (50 dB/s)"
    ])
    expect(returnTime.element.value).toBe(DEFAULT_METER_RETURN_RATE)

    await returnTime.setValue("very-fast")
    await flushPromises()
    expect(window.heron.updateApplicationSettings).toHaveBeenLastCalledWith(expect.any(Object), {
      meterReturnRate: "very-fast"
    })
  })
})
