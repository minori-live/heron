<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { UiTabs } from "@heron/ui"
import type { DoctorSnapshot } from "@heron/contracts"
import DoctorPlot from "./DoctorPlot.vue"
import DoctorLinear from "./DoctorLinear.vue"
import DoctorHarmonics from "./DoctorHarmonics.vue"
import DoctorModel from "./DoctorModel.vue"
import DoctorPerformance from "./DoctorPerformance.vue"
const props = defineProps<{ snapshot: DoctorSnapshot }>()
const { t } = useI18n()
const tab = ref("linear")
const report = computed(() => props.snapshot.report)
const tabs = computed(() =>
  ["linear", "harmonics", "model", "performance"].map((id) => ({
    id,
    label: t(`doctor.tabs.${id}`)
  }))
)
</script>
<template>
  <section class="report">
    <UiTabs v-model="tab" :items="tabs" :label="t('doctor.analysis')" appearance="analysis">
      <template #linear
        ><DoctorLinear v-if="report" :report="report" />
        <section v-else class="empty-panel">
          <DoctorPlot
            :title="t('doctor.frequency')"
            x-label="Hz"
            :y-label="t('doctor.units.db')"
            :series="[]"
            :y-domain="[-6, 6]"
            logarithmic
          /></section
      ></template>
      <template #harmonics
        ><DoctorHarmonics v-if="report" :report="report" />
        <section v-else class="empty-panel">
          <DoctorPlot
            :title="t('doctor.spectrum2d')"
            x-label="s"
            y-label="Hz"
            :series="[]"
            :x-domain="[0, snapshot.settings.sweep_seconds]"
            :y-domain="[0, snapshot.settings.sample_rate / 2]"
          /></section
      ></template>
      <template #model
        ><DoctorModel v-if="report" :report="report" />
        <section v-else class="empty-panel">
          <DoctorPlot
            :title="t('doctor.nonlinearity')"
            :x-label="t('doctor.input')"
            :y-label="t('doctor.output')"
            :series="[]"
            :x-domain="[-1, 1]"
            :y-domain="[-1, 1]"
          /></section
      ></template>
      <template #performance
        ><DoctorPerformance v-if="report" :snapshot="snapshot" />
        <section v-else class="empty-performance"></section
      ></template>
    </UiTabs>
  </section>
</template>
<style scoped>
.report {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.report > :deep(.ui-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.empty-panel {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.empty-performance {
  flex: 1;
}
</style>
