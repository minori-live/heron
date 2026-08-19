<script setup lang="ts">
import UiIconButton from "./UiIconButton.vue"
import UiSlider from "./UiSlider.vue"

const model = defineModel<number>({ required: true })
const props = withDefaults(
  defineProps<{
    label: string
    resetLabel: string
    min?: number
    max?: number
    step?: number
    valueText?: string
    disabled?: boolean
    visual?: "timeline" | "track-height" | "waveform"
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    valueText: undefined,
    disabled: false,
    visual: undefined
  }
)
const emit = defineEmits<{ reset: [] }>()
</script>

<template>
  <div class="ui-zoom-control">
    <span
      v-if="props.visual"
      class="ui-zoom-control__visual"
      :title="props.label"
      aria-hidden="true"
    >
      <svg v-if="props.visual === 'timeline'" viewBox="0 0 18 14">
        <path d="M1.5 10.5h15M3 4v6.5m4-4v4m4-4v4m4-6.5v6.5" />
      </svg>
      <svg v-else-if="props.visual === 'track-height'" viewBox="0 0 18 14">
        <path
          d="M2 2.5h14v3H2zm0 6h14v3H2zM9 1v3m0 6v3M7.5 2.5 9 1l1.5 1.5M7.5 11.5 9 13l1.5-1.5"
        />
      </svg>
      <svg v-else viewBox="0 0 18 14">
        <path d="M1 7h2l1.5-3 2.2 6 2-8 2.3 10 2-7 1.5 2H17" />
      </svg>
    </span>
    <UiSlider
      v-model="model"
      :label="props.label"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :value-text="props.valueText"
      :disabled="props.disabled"
    />
    <UiIconButton
      :label="props.resetLabel"
      :disabled="props.disabled"
      size="sm"
      @click="emit('reset')"
    >
      <slot name="reset-icon">↺</slot>
    </UiIconButton>
  </div>
</template>

<style scoped>
.ui-zoom-control {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(5.375rem, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-2);
}
.ui-zoom-control__visual {
  display: grid;
  width: 1.125rem;
  height: 0.875rem;
  place-items: center;
  color: var(--ui-color-text-subtle);
}
.ui-zoom-control__visual svg {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1;
}
</style>
