import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { INITIAL_AUDIO_RUNTIME_SNAPSHOT } from "@heron/contracts"
import type { SystemPerformanceSnapshot } from "@heron/contracts"
import type { AudioTelemetryStatistics } from "../../stores/audioRuntime"
import PerformanceSummaryList from "./PerformanceSummaryList.vue"

const statistics: AudioTelemetryStatistics = {
  sampleCount: 2,
  averageRoundTripLatencyMs: 18,
  maximumRoundTripLatencyMs: 24,
  maximumOutputLatencyMs: 8,
  minimumRingBufferFillFrames: 64,
  maximumRingBufferFillFrames: 128,
  sessionXruns: 2
}

const snapshot: SystemPerformanceSnapshot = {
  capturedAt: 1,
  cpu: {
    overallUsagePercent: 62.4,
    cores: [
      { index: 0, usagePercent: 20, speedMhz: 2_400 },
      { index: 1, usagePercent: 99, speedMhz: 2_500 }
    ]
  },
  memory: {
    totalBytes: 8 * 1024 ** 3,
    usedBytes: 3 * 1024 ** 3,
    freeBytes: 5 * 1024 ** 3,
    usagePercent: 37.5
  },
  storage: [],
  audioRuntime: null
}

describe("PerformanceSummaryList", () => {
  it("shows only the four session essentials", () => {
    const wrapper = mount(PerformanceSummaryList, {
      props: {
        snapshot,
        runtime: {
          ...INITIAL_AUDIO_RUNTIME_SNAPSHOT,
          state: "running",
          estimatedRoundTripLatencyMs: 21
        },
        statistics
      }
    })

    const rows = wrapper.findAll(".summary-row")
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.text())).toEqual([
      "CPU load62%",
      "Memory use38%",
      "Round-trip latency21.0 ms",
      "Audio dropouts2"
    ])
    expect(wrapper.text()).not.toContain("C01")
    expect(wrapper.text()).not.toContain("99%")
    expect(wrapper.text()).not.toContain("Runtime workers")
  })

  it("uses compact unavailable values before measurements arrive", () => {
    const wrapper = mount(PerformanceSummaryList, {
      props: {
        snapshot: null,
        runtime: INITIAL_AUDIO_RUNTIME_SNAPSHOT,
        statistics: { ...statistics, averageRoundTripLatencyMs: null, sessionXruns: 0 }
      }
    })

    expect(wrapper.text()).toContain("CPU load—")
    expect(wrapper.text()).toContain("Round-trip latency—")
  })
})
