<script setup lang="ts">
import UiIconButton from "./UiIconButton.vue"

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
  <div class="ui-zoom-control" :class="{ 'ui-zoom-control--visual': props.visual }">
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
    <input
      v-model.number="model"
      class="ui-zoom-control__slider"
      type="range"
      :aria-label="props.label"
      :title="props.resetLabel"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :aria-valuetext="props.valueText"
      :style="{
        '--zoom-fill': `${props.max === props.min ? 0 : Math.max(0, Math.min(100, ((model - props.min) / (props.max - props.min)) * 100))}%`
      }"
      :disabled="props.disabled"
      @dblclick.stop.prevent="!props.disabled && emit('reset')"
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
  grid-template-columns: minmax(5.375rem, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-2);
}
.ui-zoom-control--visual {
  grid-template-columns: auto minmax(5.375rem, 1fr) auto;
}
.ui-zoom-control__slider {
  width: 100%;
  height: 14px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.ui-zoom-control__slider::-webkit-slider-runnable-track {
  height: 3px;
  background: linear-gradient(
    to right,
    var(--ui-color-action) 0 var(--zoom-fill),
    var(--ui-color-border-strong) var(--zoom-fill) 100%
  );
}
.ui-zoom-control__slider::-webkit-slider-thumb {
  width: 7px;
  height: 13px;
  margin-top: -5px;
  border: 1px solid var(--ui-color-text-muted);
  border-radius: 1px;
  appearance: none;
  background: var(--ui-color-control);
  box-shadow: 0 0 0 1px var(--ui-color-surface);
}
.ui-zoom-control__slider::-moz-range-track {
  height: 3px;
  background: var(--ui-color-border-strong);
}
.ui-zoom-control__slider::-moz-range-progress {
  height: 3px;
  background: var(--ui-color-action);
}
.ui-zoom-control__slider::-moz-range-thumb {
  width: 7px;
  height: 13px;
  border: 1px solid var(--ui-color-text-muted);
  border-radius: 1px;
  background: var(--ui-color-control);
}
.ui-zoom-control__slider:focus-visible {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: 2px;
}
.ui-zoom-control__slider:disabled {
  cursor: not-allowed;
  opacity: var(--ui-opacity-disabled);
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
