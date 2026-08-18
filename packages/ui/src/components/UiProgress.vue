<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(
  defineProps<{
    value?: number | null
    max?: number
    label: string
    valueText?: string
  }>(),
  {
    value: null,
    max: 100,
    valueText: undefined
  }
)

const normalizedValue = computed(() => {
  if (props.value === null || props.value === undefined) return null
  return Math.min(props.max, Math.max(0, props.value))
})

const percentage = computed(() =>
  normalizedValue.value === null ? 0 : (normalizedValue.value / props.max) * 100
)
</script>

<template>
  <div
    class="ui-progress relative h-2 w-full overflow-hidden rounded-ui-pill bg-ui-surface-active"
    :class="{ 'ui-progress--indeterminate': normalizedValue === null }"
    role="progressbar"
    :aria-label="props.label"
    :aria-valuemin="normalizedValue === null ? undefined : 0"
    :aria-valuemax="normalizedValue === null ? undefined : props.max"
    :aria-valuenow="normalizedValue ?? undefined"
    :aria-valuetext="props.valueText"
  >
    <span
      class="ui-progress__bar block h-full bg-ui-action [border-radius:inherit] transition-[width] duration-[var(--ui-motion-normal)] ease-[var(--ui-ease-standard)]"
      :style="{ width: `${percentage}%` }"
    />
  </div>
</template>

<style scoped>
.ui-progress--indeterminate .ui-progress__bar {
  width: 36% !important;
  animation: ui-progress-indeterminate 1.2s var(--ui-ease-standard) infinite;
}

@keyframes ui-progress-indeterminate {
  from {
    transform: translateX(-110%);
  }

  to {
    transform: translateX(310%);
  }
}
</style>
