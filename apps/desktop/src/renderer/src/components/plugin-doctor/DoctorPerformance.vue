<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiProgress } from "@heron/ui"
import type { DoctorSnapshot } from "@heron/contracts"
const props = defineProps<{ snapshot: DoctorSnapshot }>()
const { t } = useI18n()
const report = computed(() => props.snapshot.report!)
const performance = computed(() => report.value.performance)
const budget = computed(() => (performance.value.p99_block_us / performance.value.budget_us) * 100)
const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2)
</script>
<template>
  <section class="performance-panel">
    <div class="headline-metrics">
      <article>
        <h3>{{ t("doctor.reportedLatency") }}</h3>
        <strong
          >{{
            ((performance.reported_latency_samples / report.settings.sample_rate) * 1000).toFixed(3)
          }}
          <span>ms</span></strong
        >
        <p>{{ performance.reported_latency_samples }} {{ t("doctor.samples") }}</p>
      </article>
      <article>
        <h3>{{ t("doctor.cpuBudget") }}</h3>
        <strong>{{ budget.toFixed(2) }}<span>%</span></strong
        ><UiProgress :label="t('doctor.cpuBudget')" :value="budget" />
      </article>
      <article>
        <h3>{{ t("doctor.blockTime") }}</h3>
        <strong>{{ performance.average_block_us.toFixed(2) }} <span>μs</span></strong>
        <p>{{ t("doctor.blockSize") }} · {{ report.settings.block_size }}</p>
      </article>
    </div>
    <dl class="metrics">
      <dt>{{ t("doctor.percentiles") }}</dt>
      <dd>
        {{ performance.p95_block_us.toFixed(2) }} / {{ performance.p99_block_us.toFixed(2) }} /
        {{ performance.maximum_block_us.toFixed(2) }} μs
      </dd>
      <dt>{{ t("doctor.deadlineMisses") }}</dt>
      <dd>{{ performance.deadline_misses }} / {{ performance.measured_blocks }}</dd>
      <dt>{{ t("doctor.workspaceMemory") }}</dt>
      <dd>≈ {{ mib(performance.buffer_bytes) }} {{ t("doctor.units.mib") }}</dd>
      <template v-if="snapshot.memory"
        ><dt>{{ t("doctor.loadedMemory") }}</dt>
        <dd>
          {{ mib(snapshot.memory.loadedBytes - snapshot.memory.baselineBytes) }}
          {{ t("doctor.units.mib") }}
        </dd>
        <dt>{{ t("doctor.peakMemory") }}</dt>
        <dd>
          {{ mib(snapshot.memory.peakBytes - snapshot.memory.baselineBytes) }}
          {{ t("doctor.units.mib") }}
        </dd>
        <dt>{{ t("doctor.retainedMemory") }}</dt>
        <dd>
          {{ mib(snapshot.memory.releasedBytes - snapshot.memory.baselineBytes) }}
          {{ t("doctor.units.mib") }}
        </dd></template
      >
    </dl>
  </section>
</template>
<style scoped>
.performance-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 28px;
  background: var(--ui-color-canvas-subtle);
}
.headline-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 1px solid var(--ui-color-border);
  padding-bottom: 28px;
  margin-bottom: 28px;
}
.headline-metrics article {
  min-width: 0;
  padding: 0 24px;
  border-right: 1px solid var(--ui-color-border);
}
.headline-metrics article:first-child {
  padding-left: 0;
}
.headline-metrics article:last-child {
  border: 0;
}
h3 {
  margin: 0 0 18px;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
  font-weight: var(--ui-type-weight-regular);
}
strong {
  font: var(--ui-type-size-page-title) var(--ui-type-family-data);
  color: var(--ui-signal-mixer-input);
}
strong span {
  font-size: var(--ui-type-size-control);
  color: var(--ui-color-text-subtle);
}
article p {
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-caption);
}
article > :deep(.ui-progress) {
  margin-top: 18px;
}
.metrics {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 2fr;
  gap: 20px;
  font-size: var(--ui-type-size-control);
}
.metrics dt {
  color: var(--ui-color-text-muted);
}
.metrics dd {
  margin: 0;
  font-family: var(--ui-type-family-data);
}
</style>
