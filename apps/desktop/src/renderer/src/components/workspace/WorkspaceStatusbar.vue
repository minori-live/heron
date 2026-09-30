<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { CircleGauge, Radio } from "@lucide/vue"
import type { AudioRuntimeSnapshot } from "@heron/contracts"
import PerformanceMonitorPopover from "../performance/PerformanceMonitorPopover.vue"
import type { AudioTelemetryStatistics, AudioWarning } from "../../stores/audioRuntime"

defineProps<{
  runtime: AudioRuntimeSnapshot
  statistics: AudioTelemetryStatistics
  audioWarnings: AudioWarning[]
}>()

const { t } = useI18n()

function formatLatency(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} ms`
}
</script>

<template>
  <footer
    class="statusbar col-span-full flex min-w-0 items-center gap-ui-4 border-t border-t-solid bg-[var(--ui-daw-statusbar)] py-0 pe-[6px] ps-[13px] text-[var(--ui-color-text-subtle)] [border-top-color:var(--ui-color-border-strong)]"
  >
    <span class="engine-state"
      ><i :class="{ active: runtime.state === 'running' }" />{{
        runtime.state === "running"
          ? t("studio.statusbar.audioActive")
          : t("studio.statusbar.audioStopped")
      }}</span
    >
    <span
      ><Radio :size="10" />{{
        runtime.sampleRate
          ? t("studio.statusbar.sampleRate", { rate: runtime.sampleRate / 1000 })
          : t("studio.statusbar.sampleRateUnknown")
      }}
      · {{ t("studio.statusbar.bitDepth") }}</span
    >
    <span
      ><CircleGauge :size="10" />{{
        runtime.outputBufferSize === null || runtime.outputBufferSize === undefined
          ? t("studio.statusbar.bufferUnknown")
          : t("studio.statusbar.buffer", { size: runtime.outputBufferSize })
      }}</span
    >
    <span>{{
      t("studio.statusbar.rtl", { latency: formatLatency(runtime.estimatedRoundTripLatencyMs) })
    }}</span>
    <span>{{
      t("studio.statusbar.avg", { latency: formatLatency(statistics.averageRoundTripLatencyMs) })
    }}</span>
    <span class="status-spacer" />
    <span :class="{ alert: statistics.sessionXruns > 0 }">{{
      t("studio.statusbar.xrun", { count: statistics.sessionXruns })
    }}</span>
    <PerformanceMonitorPopover
      :runtime="runtime"
      :statistics="statistics"
      :audio-warnings="audioWarnings"
    />
  </footer>
</template>

<style scoped>
.statusbar {
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
}
.statusbar > span {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.engine-state {
  color: var(--ui-color-text-muted);
}
.engine-state i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ui-color-text-faint);
}
.engine-state i.active {
  background: var(--ui-signal-audio);
  box-shadow: 0 0 6px var(--ui-signal-audio);
}
.status-spacer {
  flex: 1;
}
.statusbar .alert {
  color: var(--ui-signal-record);
}
</style>
