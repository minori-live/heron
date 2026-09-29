<script setup lang="ts">
import { storeToRefs } from "pinia"
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { CircleAlert, RefreshCw, TriangleAlert } from "@lucide/vue"
import type { AudioRuntimeSnapshot } from "@heron/contracts"
import { UiButton, UiIconButton, UiPopover } from "@heron/ui"
import type { AudioTelemetryStatistics, AudioWarning } from "../../stores/audioRuntime"
import {
  classifyUpperBound,
  highestSeverity,
  PERFORMANCE_THRESHOLDS,
  useSystemPerformanceStore
} from "../../stores/systemPerformance"
import type { HealthSeverity, PerformanceWarning } from "../../stores/systemPerformance"
import PerformanceSummaryList from "./PerformanceSummaryList.vue"

const props = defineProps<{
  runtime: AudioRuntimeSnapshot
  statistics: AudioTelemetryStatistics
  audioWarnings: AudioWarning[]
}>()

const systemPerformanceStore = useSystemPerformanceStore()
const { t } = useI18n()
const {
  snapshot,
  warnings: systemWarnings,
  severity: systemSeverity,
  isRefreshing
} = storeToRefs(systemPerformanceStore)

const monitoredRoundTripLatency = computed<number | null>(() => {
  if (props.runtime.state !== "running") return null
  const values = [
    props.runtime.estimatedRoundTripLatencyMs,
    props.statistics.averageRoundTripLatencyMs
  ].filter((value): value is number => value !== null)
  return values.length > 0 ? Math.max(...values) : null
})

const latencySeverity = computed<HealthSeverity>(() => {
  if (props.runtime.state !== "running") return "normal"
  return classifyUpperBound(
    monitoredRoundTripLatency.value,
    PERFORMANCE_THRESHOLDS.audioRoundTrip.warningMs,
    PERFORMANCE_THRESHOLDS.audioRoundTrip.criticalMs
  )
})

const audioSeverity = computed<HealthSeverity>(() =>
  highestSeverity([
    latencySeverity.value,
    ...props.audioWarnings.map((warning) => warning.severity)
  ])
)

const severity = computed<HealthSeverity>(() =>
  highestSeverity([systemSeverity.value, audioSeverity.value])
)

const latencyWarning = computed<PerformanceWarning | null>(() => {
  if (latencySeverity.value === "normal") return null
  const value = props.runtime.estimatedRoundTripLatencyMs
  return {
    id: "audio-latency",
    severity: latencySeverity.value,
    title:
      latencySeverity.value === "critical"
        ? t("performance.latency.criticalTitle")
        : t("performance.latency.warningTitle"),
    message: t("performance.latency.message", {
      latency: formatLatency(monitoredRoundTripLatency.value ?? value)
    })
  }
})

const activeWarnings = computed<PerformanceWarning[]>(() => [
  ...systemWarnings.value,
  ...props.audioWarnings.map((warning) => ({ ...warning })),
  ...(latencyWarning.value ? [latencyWarning.value] : [])
])

const cpuUsage = computed(() => snapshot.value?.cpu.overallUsagePercent ?? null)
const memoryUsage = computed(() => snapshot.value?.memory.usagePercent ?? null)
function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`
}

function formatLatency(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} ms`
}
</script>

<template>
  <UiPopover align="end" side="top" :side-offset="9" content-class="performance-popover-shell">
    <template #trigger>
      <UiButton
        size="status"
        variant="ghost"
        :class="['performance-trigger', severity]"
        :aria-label="
          t('performance.trigger.ariaLabel', {
            severity: t(`performance.severity.${severity}`)
          })
        "
      >
        <span class="health-light" aria-hidden="true" />
        <span>{{ t("performance.trigger.cpu") }} {{ formatPercent(cpuUsage) }}</span>
        <span>{{ t("performance.trigger.mem") }} {{ formatPercent(memoryUsage) }}</span>
      </UiButton>
    </template>
    <div class="performance-popover">
      <header class="performance-header">
        <div>
          <span>{{ t("performance.header.kicker") }}</span>
          <strong>{{ t("performance.header.title") }}</strong>
        </div>
        <div class="performance-header-actions">
          <span :class="['health-badge', severity]">{{
            t(`performance.severity.${severity}`)
          }}</span>
          <UiIconButton
            class="refresh-performance"
            :label="t('performance.header.refreshAria')"
            size="sm"
            :disabled="isRefreshing"
            @click="systemPerformanceStore.refresh"
          >
            <RefreshCw :class="{ spinning: isRefreshing }" :size="12" />
          </UiIconButton>
        </div>
      </header>

      <section v-if="activeWarnings.length > 0" class="performance-alerts" aria-live="polite">
        <div class="alerts-heading">
          <strong>{{ t("performance.issues.title") }}</strong>
          <span>{{ t("performance.issues.count", { count: activeWarnings.length }) }}</span>
        </div>
        <article
          v-for="warning in activeWarnings"
          :key="warning.id"
          :class="['performance-alert', warning.severity]"
        >
          <component
            :is="warning.severity === 'critical' ? CircleAlert : TriangleAlert"
            :size="12"
          />
          <div>
            <strong>{{ warning.title }}</strong
            ><span>{{ warning.message }}</span>
          </div>
        </article>
      </section>

      <PerformanceSummaryList :snapshot="snapshot" :runtime="runtime" :statistics="statistics" />
    </div>
  </UiPopover>
</template>

<style>
.performance-trigger {
  display: flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 4px;
  gap: 8px;
  color: var(--ui-color-text-subtle);
  background: transparent;
  letter-spacing: var(--ui-type-tracking-wide);
}
.performance-trigger.warning {
  border-color: color-mix(in srgb, var(--ui-color-warning) 45%, var(--ui-color-border-strong));
  color: var(--ui-color-warning);
  background: color-mix(in srgb, var(--ui-color-warning) 10%, var(--ui-daw-statusbar));
}
.performance-trigger.critical {
  border-color: color-mix(in srgb, var(--ui-signal-record) 45%, var(--ui-color-border-strong));
  color: var(--ui-signal-record);
  background: color-mix(in srgb, var(--ui-signal-record) 10%, var(--ui-daw-statusbar));
}
.health-light {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ui-signal-audio);
  box-shadow: 0 0 6px color-mix(in srgb, var(--ui-signal-audio) 60%, transparent);
}
.warning .health-light {
  background: var(--ui-color-warning);
  box-shadow: 0 0 7px color-mix(in srgb, var(--ui-color-warning) 66%, transparent);
}
.critical .health-light {
  background: var(--ui-signal-record);
  box-shadow: 0 0 7px color-mix(in srgb, var(--ui-signal-record) 72%, transparent);
}
.performance-popover {
  z-index: var(--ui-z-dropdown);
  width: min(390px, calc(100vw - 16px));
  max-height: min(460px, calc(100vh - 24px));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 10px;
  outline: none;
  color: var(--ui-color-text);
  background: var(--ui-color-surface);
  box-shadow: 0 24px 64px var(--ui-color-shadow);
  transform-origin: var(--reka-popover-content-transform-origin);
  animation: performance-surface-in 120ms ease-out;
}
.performance-header {
  position: sticky;
  z-index: var(--ui-z-local-raised);
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 10px;
  border-bottom: 1px solid var(--ui-color-border);
  background: color-mix(in srgb, var(--ui-color-surface-raised) 93%, transparent);
  backdrop-filter: blur(10px);
}
.performance-popover-shell {
  max-width: none;
  max-height: none;
  overflow: visible;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.performance-popover-shell > .ui-popover__arrow {
  fill: var(--ui-color-border-strong);
}
.performance-header > div:first-child > span,
.performance-header > div:first-child > strong {
  display: block;
}
.performance-header > div:first-child > span {
  color: var(--ui-color-action);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  text-transform: uppercase;
  letter-spacing: var(--ui-type-tracking-widest);
}
.performance-header > div:first-child > strong {
  margin-top: 4px;
  font-size: var(--ui-type-size-section-title);
}
.performance-header-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}
.health-badge {
  padding: 4px 7px;
  border: 1px solid color-mix(in srgb, var(--ui-signal-audio) 50%, var(--ui-color-border-strong));
  border-radius: 4px;
  color: var(--ui-signal-audio);
  background: color-mix(in srgb, var(--ui-signal-audio) 10%, var(--ui-color-surface-raised));
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  text-transform: uppercase;
  letter-spacing: var(--ui-type-tracking-wide);
}
.health-badge.warning {
  border-color: color-mix(in srgb, var(--ui-color-warning) 45%, var(--ui-color-border-strong));
  color: var(--ui-color-warning);
  background: color-mix(in srgb, var(--ui-color-warning) 10%, var(--ui-color-surface-raised));
}
.health-badge.critical {
  border-color: color-mix(in srgb, var(--ui-signal-record) 45%, var(--ui-color-border-strong));
  color: var(--ui-signal-record);
  background: color-mix(in srgb, var(--ui-signal-record) 10%, var(--ui-color-surface-raised));
}
.refresh-performance {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 5px;
  color: var(--ui-color-text-subtle);
  background: var(--ui-daw-control);
}
.refresh-performance:disabled {
  opacity: 0.55;
}
.spinning {
  animation: monitor-spin 0.8s linear infinite;
}
.performance-alerts {
  display: grid;
  padding: 8px;
  border-bottom: 1px solid var(--ui-color-border);
  gap: 5px;
  background: var(--ui-color-surface);
}
.alerts-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1px 1px 3px;
  color: var(--ui-color-text-subtle);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  text-transform: uppercase;
  letter-spacing: var(--ui-type-tracking-wide);
}
.performance-alert {
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr);
  align-items: start;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--ui-color-warning) 42%, var(--ui-color-border-strong));
  border-radius: 6px;
  gap: 7px;
  color: var(--ui-color-warning);
  background: color-mix(in srgb, var(--ui-color-warning) 10%, var(--ui-color-surface-raised));
}
.performance-alert.critical {
  border-color: color-mix(in srgb, var(--ui-signal-record) 45%, var(--ui-color-border-strong));
  color: var(--ui-signal-record);
  background: color-mix(in srgb, var(--ui-signal-record) 10%, var(--ui-color-surface-raised));
}
.performance-alert div {
  min-width: 0;
}
.performance-alert strong,
.performance-alert span {
  display: block;
}
.performance-alert strong {
  font-size: var(--ui-type-size-control);
}
.performance-alert span {
  margin-top: 3px;
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-caption);
  line-height: var(--ui-type-leading-normal);
}
.performance-alert.critical span {
  color: var(--ui-color-text-subtle);
}
@keyframes monitor-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes performance-surface-in {
  from {
    opacity: 0;
    transform: translateY(3px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
