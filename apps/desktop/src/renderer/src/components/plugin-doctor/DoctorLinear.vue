<script setup lang="ts">
import { computed, ref, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import {
  UiButton,
  UiCheckbox,
  UiSegmentedControl,
  UiSelect,
  type UiAnalysisSeries
} from "@heron/ui"
import type { DoctorReport } from "@heron/contracts"
import DoctorPlot from "./DoctorPlot.vue"
const props = defineProps<{ report: DoctorReport }>()
const { t } = useI18n()
const view = ref("magnitude")
const path = ref("direct")
const compensate = ref(false)
const stored = shallowRef<UiAnalysisSeries[]>([])
const modes = computed(() => [
  { value: "magnitude", label: t("doctor.magnitude") },
  { value: "phase", label: t("doctor.phase") },
  { value: "impulse", label: t("doctor.impulse") }
])
const paths = computed(() => [
  { value: "direct", label: t("doctor.bothChannels") },
  ...props.report.responses.map((p, i) => ({
    value: String(i),
    label: `${p.input ? "R" : "L"} → ${p.output ? "R" : "L"}`
  }))
])
const responses = computed(() =>
  props.report.responses.filter((p, i) =>
    path.value === "direct" ? p.input === p.output : i === Number(path.value)
  )
)
const series = computed<UiAnalysisSeries[]>(() =>
  responses.value.map((p, index) => ({
    label: `${p.input ? "R" : "L"} → ${p.output ? "R" : "L"}`,
    color: index ? "var(--ui-color-action)" : "var(--ui-signal-mixer-input)",
    x:
      view.value === "impulse"
        ? p.impulse.map(
            (_, i) =>
              ((p.impulse_start_samples +
                i * p.impulse_stride -
                (compensate.value ? (p.delay_samples ?? 0) : 0)) /
                props.report.settings.sample_rate) *
              1000
          )
        : p.frequency_hz,
    y:
      view.value === "magnitude"
        ? p.magnitude_db
        : view.value === "impulse"
          ? p.impulse
          : p.phase_degrees.map((value, i) =>
              value === null
                ? null
                : value +
                  (compensate.value
                    ? (360 * p.frequency_hz[i]! * (p.delay_samples ?? 0)) /
                      props.report.settings.sample_rate
                    : 0)
            )
  }))
)
const displayed = computed(() => [...stored.value, ...series.value])
const responseDomain = computed<readonly [number, number] | undefined>(() => {
  if (view.value === "impulse") return undefined
  const values = displayed.value.flatMap((s) =>
    s.y.filter((v): v is number => v !== null && Number.isFinite(v))
  )
  // Keep at least one degree per phase grid interval; numerical noise is not useful zoom.
  const extent = view.value === "phase" ? 3 : 6
  return [
    Math.min(-extent, Math.floor(Math.min(...values, 0) / extent) * extent),
    Math.max(extent, Math.ceil(Math.max(...values, 0) / extent) * extent)
  ]
})
const title = computed(() =>
  t(
    view.value === "magnitude"
      ? "doctor.frequency"
      : view.value === "phase"
        ? "doctor.phase"
        : "doctor.impulse"
  )
)
function store(): void {
  stored.value = series.value.map((s) => ({
    ...s,
    x: [...s.x],
    y: [...s.y],
    label: `${s.label} · ${t("doctor.stored")}`,
    dashed: true,
    color: "var(--ui-color-text-faint)"
  }))
}
function changeView(): void {
  stored.value = []
}
</script>
<template>
  <section class="linear-panel">
    <DoctorPlot
      :title="title"
      :x-label="view === 'impulse' ? 'ms' : 'Hz'"
      :y-label="
        view === 'magnitude' ? t('doctor.units.db') : view === 'phase' ? '°' : t('doctor.amplitude')
      "
      :logarithmic="view !== 'impulse'"
      :series="displayed"
      :y-domain="responseDomain"
    />
    <footer class="toolbar">
      <UiSegmentedControl
        v-model="view"
        :options="modes"
        :label="t('doctor.responseView')"
        size="compact"
        required
        @update:model-value="changeView"
      /><UiSelect
        v-model="path"
        :options="paths"
        size="sm"
        :aria-label="t('doctor.signalPath')"
      /><UiCheckbox v-model="compensate" :label="t('doctor.compensate')" /><span
        class="spacer"
      /><UiButton size="sm" variant="secondary" @click="store">{{ t("doctor.store") }}</UiButton
      ><UiButton size="sm" variant="ghost" :disabled="!stored.length" @click="stored = []">{{
        t("doctor.clear")
      }}</UiButton>
    </footer>
  </section>
</template>
<style scoped>
.linear-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-sunken);
}
.toolbar > :deep(.ui-select-shell) {
  width: 140px;
}
.spacer {
  flex: 1;
}
</style>
