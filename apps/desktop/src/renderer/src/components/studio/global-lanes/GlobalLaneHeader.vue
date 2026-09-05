<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiNumberInput } from "@heron/ui"

const props = defineProps<{
  label: string
  eyebrow: string
  value: number
  unit: string
  minimum: number
  maximum: number
  color: string
}>()

const emit = defineEmits<{
  updateValue: [value: number]
}>()

const { t } = useI18n()

const model = computed({
  get: () => props.value,
  set: (value: number | null) => {
    if (value !== null && Number.isFinite(value)) emit("updateValue", value)
  }
})
</script>

<template>
  <section
    class="global-lane-header"
    :style="{ '--lane-color': color }"
    :aria-label="t('studio.lanes.globalTrackAria', { label })"
  >
    <div class="lane-copy">
      <span>{{ eyebrow }}</span>
      <strong>{{ label }}</strong>
    </div>
    <label class="lane-value">
      <span>{{ t("studio.lanes.selected") }}</span>
      <UiNumberInput
        v-model="model"
        size="compact"
        appearance="workspace"
        :suffix="unit"
        :accent-color="color"
        :format-options="{ minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }"
        :min="minimum"
        :max="maximum"
        :step="0.01"
        :aria-label="t('studio.lanes.selectedValueAria', { label })"
      />
    </label>
  </section>
</template>

<style scoped>
.global-lane-header {
  --lane-color: var(--ui-domain-color-65a8ff);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  gap: 5px 7px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--line-strong);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--lane-color) 8%, var(--daw-track-header)),
    var(--daw-track-header) 74%
  );
  box-shadow: 3px 0 0 var(--lane-color) inset;
}
.lane-copy {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}
.lane-copy span,
.lane-copy strong {
  display: block;
}
.lane-copy span {
  color: var(--lane-color);
  font: var(--ui-type-weight-bold) var(--ui-type-size-micro) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wider);
}
.lane-copy strong {
  margin-top: 3px;
  color: var(--text-primary);
  font: var(--ui-type-size-label) var(--ui-type-family-display);
}
.lane-value {
  display: grid;
  min-width: 0;
  grid-column: 1;
  grid-row: 2;
  align-self: end;
}
.lane-value > span:first-child {
  display: block;
  margin-bottom: 4px;
  color: var(--text-faint);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wider);
  text-transform: uppercase;
}
</style>
