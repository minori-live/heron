import { effectScope, nextTick, shallowRef } from "vue"
import { describe, expect, it } from "vitest"
import { METER_RETURN_RATE_DB_PER_SECOND, METER_RETURN_RATES } from "@heron/contracts"
import type { MeterPeakHold, MeterReturnRate, MixerChannelMeter } from "@heron/contracts"
import { usePeakMeterDisplay } from "./usePeakMeterDisplay"

function meter(peak: number, clipped = false): MixerChannelMeter {
  return {
    channelId: "audio",
    preFaderPeak: [peak, peak],
    postFaderPeak: [peak, peak],
    heldPeak: [peak, peak],
    clipped
  }
}

function stereoMeter(left: number, right: number): MixerChannelMeter {
  return {
    channelId: "stereo-instrument",
    preFaderPeak: [left, right],
    postFaderPeak: [left, right],
    heldPeak: [left, right],
    clipped: false
  }
}

describe("usePeakMeterDisplay", () => {
  it.each(METER_RETURN_RATES)("returns at the configured %s rate", async (returnRate) => {
    let timestamp = 0
    const meterSample = shallowRef(meter(1))
    const scope = effectScope()
    const display = scope.run(() =>
      usePeakMeterDisplay({
        meter: meterSample,
        peakHold: shallowRef<MeterPeakHold>("800ms"),
        returnRate: shallowRef<MeterReturnRate>(returnRate),
        now: () => timestamp
      })
    )!

    timestamp = 1_000
    meterSample.value = meter(0)
    await nextTick()

    expect(display.displayedPeakDb.value).toBeCloseTo(
      -METER_RETURN_RATE_DB_PER_SECOND[returnRate],
      5
    )
    scope.stop()
  })

  it("preserves independent stereo levels through return and peak hold", async () => {
    let timestamp = 0
    const meterSample = shallowRef(stereoMeter(0.5, 0.25))
    const scope = effectScope()
    const display = scope.run(() =>
      usePeakMeterDisplay({
        meter: meterSample,
        peakHold: shallowRef<MeterPeakHold>("800ms"),
        returnRate: shallowRef<MeterReturnRate>("iec-type-i"),
        now: () => timestamp
      })
    )!

    expect(display.displayedPeakDbByChannel.value[0]).toBeCloseTo(-6.02, 2)
    expect(display.displayedPeakDbByChannel.value[1]).toBeCloseTo(-12.04, 2)
    expect(display.meterChannels.value[0]?.levelPercent).toBeCloseTo(89.97, 2)
    expect(display.meterChannels.value[1]?.levelPercent).toBeCloseTo(79.93, 2)

    timestamp = 1_000
    meterSample.value = stereoMeter(0, 0.5)
    await nextTick()
    expect(display.displayedPeakDbByChannel.value[0]).toBeCloseTo(-17.82, 2)
    expect(display.displayedPeakDbByChannel.value[1]).toBeCloseTo(-6.02, 2)
    expect(display.heldPeakDbByChannel.value[0]).toBeCloseTo(-8.38, 2)
    expect(display.heldPeakDbByChannel.value[1]).toBeCloseTo(-6.02, 2)

    scope.stop()
  })

  it("attacks immediately and returns the displayed level at IEC Type I speed", async () => {
    let timestamp = 0
    const meterSample = shallowRef(meter(0.5))
    const peakHold = shallowRef<MeterPeakHold>("800ms")
    const returnRate = shallowRef<MeterReturnRate>("iec-type-i")
    const scope = effectScope()
    const display = scope.run(() =>
      usePeakMeterDisplay({
        meter: meterSample,
        peakHold,
        returnRate,
        now: () => timestamp
      })
    )!

    expect(display.heldPeakDb.value).toBeCloseTo(-6.02, 2)
    expect(display.displayedPeakDb.value).toBeCloseTo(-6.02, 2)

    timestamp = 700
    meterSample.value = meter(0.1)
    await nextTick()
    expect(display.currentPeakDb.value).toBeCloseTo(-20, 2)
    expect(display.displayedPeakDb.value).toBeCloseTo(-14.28, 2)
    expect(display.heldPeakDb.value).toBeCloseTo(-6.02, 2)

    timestamp = 900
    meterSample.value = meter(0.1)
    await nextTick()
    expect(display.displayedPeakDb.value).toBeCloseTo(-16.64, 2)
    expect(display.heldPeakDb.value).toBeCloseTo(-7.2, 2)
    expect(display.currentPeakDb.value).toBeCloseTo(-20, 2)
    expect(display.latchedPeakDb.value).toBeCloseTo(-6.02, 2)

    display.resetPeakAndClip()
    expect(display.latchedPeakDb.value).toBe(Number.NEGATIVE_INFINITY)
    expect(display.heldPeakDb.value).toBeCloseTo(-7.2, 2)

    timestamp = 1_000
    meterSample.value = meter(0.5)
    await nextTick()
    expect(display.displayedPeakDb.value).toBeCloseTo(-6.02, 2)

    scope.stop()
  })

  it("clears a latched clip until the native meter reports its cleared state", async () => {
    const meterSample = shallowRef(meter(1, true))
    const scope = effectScope()
    const display = scope.run(() =>
      usePeakMeterDisplay({
        meter: meterSample,
        peakHold: shallowRef<MeterPeakHold>("800ms"),
        returnRate: shallowRef<MeterReturnRate>("iec-type-i"),
        now: () => 0
      })
    )!

    expect(display.clipped.value).toBe(true)
    display.resetPeakAndClip()
    expect(display.clipped.value).toBe(false)

    meterSample.value = meter(1, true)
    await nextTick()
    expect(display.clipped.value).toBe(false)
    meterSample.value = meter(0, false)
    await nextTick()
    meterSample.value = meter(1, true)
    await nextTick()
    expect(display.clipped.value).toBe(true)

    scope.stop()
  })
})
