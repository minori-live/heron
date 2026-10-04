import { DEFAULT_PLUGIN_ANALYSIS_SETTINGS } from "@heron/contracts"
import type { PluginAnalysisReport, PluginAnalysisSnapshot } from "@heron/contracts"

export function analysisReport(): PluginAnalysisReport {
  return {
    settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS },
    responses: [
      {
        input: 0,
        output: 0,
        frequency_hz: [100, 1000],
        magnitude_db: [-12, 6],
        phase_degrees: [0, null],
        impulse: [1, 0.5],
        impulse_stride: 48,
        impulse_start_samples: 96,
        delay_samples: 48,
        tail_truncated: false,
        silence_rms: 0,
        repeat_error_percent: 0
      },
      {
        input: 1,
        output: 1,
        frequency_hz: [100, 1000],
        magnitude_db: [-3, 0],
        phase_degrees: [-30, -60],
        impulse: [0.25, 0],
        impulse_stride: 24,
        impulse_start_samples: 0,
        delay_samples: null,
        tail_truncated: false,
        silence_rms: 0,
        repeat_error_percent: 0
      },
      {
        input: 0,
        output: 1,
        frequency_hz: [100, 1000],
        magnitude_db: [-60, -40],
        phase_degrees: [10, 20],
        impulse: [0.01],
        impulse_stride: 1,
        impulse_start_samples: 0,
        delay_samples: null,
        tail_truncated: false,
        silence_rms: 0,
        repeat_error_percent: 0
      }
    ],
    distortion: [],
    oscilloscopes: [],
    dynamics: [],
    harmonics: [0, 1].map((channel) => ({
      channel,
      frequency_hz: [100, 1000],
      orders_db: [[channel ? -40 : -20, null]],
      fundamental_gain_db: [0, 0],
      thd_percent: [channel ? 1 : 10, null]
    })),
    spectrograms: [
      {
        channel: 0,
        logarithmic_sweep: true,
        columns: 2,
        rows: 2,
        duration_seconds: 1.25,
        maximum_frequency_hz: 24000,
        magnitude_dbfs: [-120, -18, -12, -6]
      },
      {
        channel: 1,
        logarithmic_sweep: false,
        columns: 2,
        rows: 2,
        duration_seconds: 1.5,
        maximum_frequency_hz: 24000,
        magnitude_dbfs: [-100, -40, -30, -20]
      }
    ],
    models: [0, 1].map((channel) => ({
      channel,
      dc_offset: 0,
      filters: channel
        ? [[0, 1]]
        : [
            [1, -1],
            [0.5, -0.5]
          ],
      input_scale: 0.5,
      delay_samples: 48,
      validation_error_percent: channel ? 25 : 0.25,
      suitable: channel === 0,
      predicted: [0.2, 0.4],
      observed: [0.21, 0.39],
      validation_stride: 48
    })),
    performance: {
      reported_latency_samples: 48,
      average_block_us: 20,
      p95_block_us: 30,
      p99_block_us: 40,
      maximum_block_us: 60,
      budget_us: 100,
      deadline_misses: 2,
      measured_blocks: 100,
      block_sizes: [],
      buffer_bytes: 1048576
    }
  }
}

export function analysisSnapshot(
  overrides: Partial<PluginAnalysisSnapshot> = {}
): PluginAnalysisSnapshot {
  return {
    ref: { kind: "plugin-analysis", id: "analysis", epoch: "epoch", generation: 1 },
    revision: 3,
    plugins: [],
    runtime: {},
    catalog: [],
    settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS },
    automatic: true,
    comparisonEnabled: false,
    repeating: false,
    comparisonReport: null,
    differenceReport: null,
    status: "complete",
    phase: "",
    progress: 1,
    report: analysisReport(),
    reportId: "run-1",
    reportRevision: 3,
    memory: null,
    failure: null,
    locale: "en-US",
    theme: "dark",
    ...overrides
  }
}
