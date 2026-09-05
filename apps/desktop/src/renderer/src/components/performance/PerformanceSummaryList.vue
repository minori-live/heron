<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { intlLocale } from "../../i18n"
import type { AudioRuntimeSnapshot, SystemPerformanceSnapshot } from "@heron/contracts"
import type { AudioTelemetryStatistics } from "../../stores/audioRuntime"
import { classifyUpperBound, PERFORMANCE_THRESHOLDS } from "../../stores/systemPerformance"
import type { HealthSeverity } from "../../stores/systemPerformance"

const props = defineProps<{
  snapshot: SystemPerformanceSnapshot | null
  runtime: AudioRuntimeSnapshot
  statistics: AudioTelemetryStatistics
}>()

const { t, locale } = useI18n()

interface SummaryItem {
  id: string
  label: string
  value: string
  severity: HealthSeverity
}

const monitoredLatency = computed<number | null>(() => {
  if (props.runtime.state !== "running") return null
  const values = [
    props.runtime.estimatedRoundTripLatencyMs,
    props.statistics.averageRoundTripLatencyMs
  ].filter((value): value is number => value !== null)
  return values.length > 0 ? Math.max(...values) : null
})

const items = computed<SummaryItem[]>(() => {
  const cpu = props.snapshot?.cpu.overallUsagePercent ?? null
  const memory = props.snapshot?.memory.usagePercent ?? null
  const latency = monitoredLatency.value
  const xruns = props.statistics.sessionXruns

  return [
    {
      id: "cpu",
      label: t("performance.summary.cpu"),
      value: formatPercent(cpu),
      severity: classifyUpperBound(
        cpu,
        PERFORMANCE_THRESHOLDS.cpu.warningPercent,
        PERFORMANCE_THRESHOLDS.cpu.criticalPercent
      )
    },
    {
      id: "memory",
      label: t("performance.summary.memory"),
      value: formatPercent(memory),
      severity: classifyUpperBound(
        memory,
        PERFORMANCE_THRESHOLDS.memory.warningPercent,
        PERFORMANCE_THRESHOLDS.memory.criticalPercent
      )
    },
    {
      id: "latency",
      label: t("performance.summary.roundTrip"),
      value: formatLatency(latency),
      severity: classifyUpperBound(
        latency,
        PERFORMANCE_THRESHOLDS.audioRoundTrip.warningMs,
        PERFORMANCE_THRESHOLDS.audioRoundTrip.criticalMs
      )
    },
    {
      id: "xruns",
      label: t("performance.summary.xruns"),
      value: xruns.toLocaleString(intlLocale(locale.value)),
      severity: xruns >= 5 ? "critical" : xruns > 0 ? "warning" : "normal"
    }
  ]
})

function formatPercent(value: number | null): string {
  return value === null ? t("performance.summary.unavailable") : `${Math.round(value)}%`
}

function formatLatency(value: number | null): string {
  return value === null ? t("performance.summary.unavailable") : `${value.toFixed(1)} ms`
}
</script>

<template>
  <section class="performance-summary" :aria-label="t('performance.summary.title')">
    <h3>{{ t("performance.summary.title") }}</h3>
    <dl class="performance-summary-list">
      <div v-for="item in items" :key="item.id" :class="['summary-row', item.severity]">
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.performance-summary {
  padding: 10px;
}

.performance-summary h3 {
  margin: 0 0 6px;
  color: var(--text-faint);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  text-transform: uppercase;
  letter-spacing: var(--ui-type-tracking-widest);
}

.performance-summary-list {
  display: grid;
  margin: 0;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface-1);
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 30px;
  padding: 0 9px;
  border-bottom: 1px solid var(--line-soft);
  gap: 16px;
}

.summary-row:last-child {
  border-bottom: 0;
}

.summary-row dt {
  color: var(--text-muted);
  font-size: var(--ui-type-size-control);
}

.summary-row dd {
  margin: 0;
  color: var(--signal-cyan);
  font: var(--ui-type-weight-semibold) var(--ui-type-size-body-compact) var(--ui-type-family-data);
  white-space: nowrap;
}

.summary-row.warning dd {
  color: var(--warning);
}

.summary-row.critical dd {
  color: var(--record);
}
</style>
