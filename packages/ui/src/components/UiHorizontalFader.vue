<script setup lang="ts">
import { computed, shallowRef, watch } from "vue"

const props = withDefaults(
  defineProps<{
    value: number
    min: number
    max: number
    step: number
    defaultValue: number
    label: string
    valueText?: (value: number) => string
    meterLevelPercent?: number
    disabled?: boolean
  }>(),
  {
    valueText: undefined,
    meterLevelPercent: 0,
    disabled: false
  }
)

const emit = defineEmits<{
  preview: [value: number]
  commit: [value: number]
}>()

const gestureStartValue = shallowRef<number | null>(null)
const gestureValue = shallowRef(props.value)
const tooltipVisible = shallowRef(false)
const cancelled = shallowRef(false)

const precision = computed(() => String(props.step).split(".")[1]?.length ?? 0)
const displayedValue = computed(() =>
  gestureStartValue.value === null ? props.value : gestureValue.value
)
const displayText = computed(
  () => props.valueText?.(displayedValue.value) ?? displayedValue.value.toFixed(precision.value)
)
const valuePercent = computed(() =>
  props.max === props.min ? 0 : ((displayedValue.value - props.min) / (props.max - props.min)) * 100
)
const faderStyle = computed(() => ({
  "--horizontal-fader-meter-level": `${Math.max(0, Math.min(100, props.meterLevelPercent))}%`,
  "--horizontal-fader-value-position": `${Math.max(0, Math.min(100, valuePercent.value))}%`
}))

watch(
  () => props.value,
  (value) => {
    if (gestureStartValue.value === null) gestureValue.value = value
  }
)

function snap(value: number): number {
  const clamped = Math.max(props.min, Math.min(props.max, value))
  const steps = Math.round((clamped - props.min) / props.step)
  return Number((props.min + steps * props.step).toFixed(precision.value))
}

function beginGesture(): void {
  if (props.disabled) return
  gestureStartValue.value = props.value
  gestureValue.value = props.value
  cancelled.value = false
  tooltipVisible.value = true
}

function previewGesture(event: Event): void {
  gestureStartValue.value ??= props.value
  gestureValue.value = snap(Number((event.currentTarget as HTMLInputElement).value))
  tooltipVisible.value = true
  emit("preview", gestureValue.value)
}

function commitGesture(event: Event): void {
  const input = event.currentTarget as HTMLInputElement
  if (cancelled.value) {
    input.value = String(gestureStartValue.value ?? props.value)
    cancelled.value = false
  } else {
    emit("commit", gestureValue.value)
  }
  gestureStartValue.value = null
  tooltipVisible.value = false
}

function cancelGesture(event: Event): void {
  if (gestureStartValue.value === null) return
  const startValue = gestureStartValue.value
  gestureValue.value = startValue
  ;(event.currentTarget as HTMLInputElement).value = String(startValue)
  emit("preview", startValue)
  cancelled.value = true
  tooltipVisible.value = false
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return
  event.preventDefault()
  event.stopPropagation()
  cancelGesture(event)
}

function reset(): void {
  if (props.disabled) return
  gestureStartValue.value = null
  cancelled.value = false
  tooltipVisible.value = false
  emit("commit", snap(props.defaultValue))
}
</script>

<template>
  <label
    :class="['ui-horizontal-fader', { 'is-disabled': props.disabled }]"
    :style="faderStyle"
    :title="`${props.label}: ${displayText}`"
  >
    <span class="ui-horizontal-fader__rail" aria-hidden="true">
      <i class="ui-horizontal-fader__meter" />
    </span>
    <span class="ui-horizontal-fader__thumb" aria-hidden="true" />
    <input
      type="range"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :value="displayedValue"
      :disabled="props.disabled"
      :aria-label="props.label"
      :aria-valuetext="displayText"
      @pointerdown="beginGesture"
      @pointercancel="cancelGesture"
      @input="previewGesture"
      @change="commitGesture"
      @blur="tooltipVisible = false"
      @keydown="handleKeydown"
      @dblclick.prevent="reset"
    />
    <output v-if="tooltipVisible" class="ui-horizontal-fader__tooltip" aria-hidden="true">
      {{ displayText }}
    </output>
  </label>
</template>

<style scoped>
.ui-horizontal-fader {
  position: relative;
  display: block;
  width: 100%;
  min-width: 4rem;
  height: 15px;
}

.ui-horizontal-fader__rail {
  position: absolute;
  top: 2px;
  right: 0;
  left: 0;
  height: 11px;
  overflow: hidden;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: var(--ui-radius-sm);
  background: linear-gradient(
    to right,
    var(--ui-signal-meter-safe) 0 74%,
    var(--ui-signal-meter-warning) 86%,
    var(--ui-signal-meter-clip) 100%
  );
  box-shadow: var(--ui-shadow-highlight-inset);
}

.ui-horizontal-fader__meter {
  position: absolute;
  inset: 0 0 0 var(--horizontal-fader-meter-level);
  background: var(--daw-meter-well);
  opacity: 0.88;
  transition: left 55ms linear;
}

.ui-horizontal-fader__thumb {
  position: absolute;
  z-index: var(--ui-z-local-content);
  top: 0;
  left: var(--horizontal-fader-value-position);
  width: 7px;
  height: 15px;
  border: 1px solid var(--ui-color-text-muted);
  border-radius: 1px;
  background: linear-gradient(
    to right,
    var(--ui-color-control-hover) 0 calc(50% - 1px),
    var(--ui-color-text) calc(50% - 1px) calc(50% + 1px),
    var(--ui-color-control-hover) calc(50% + 1px) 100%
  );
  box-shadow: var(--ui-shadow-sm);
  transform: translateX(-50%);
}

.ui-horizontal-fader input {
  position: absolute;
  z-index: var(--ui-z-local-raised);
  inset: 0;
  width: 100%;
  height: 15px;
  margin: 0;
  appearance: none;
  opacity: 0;
  background: transparent;
  cursor: ew-resize;
}

.ui-horizontal-fader:focus-within {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: 1px;
}

.ui-horizontal-fader__tooltip {
  position: absolute;
  z-index: var(--ui-z-local-controls);
  top: calc(100% + var(--ui-space-1));
  left: 50%;
  min-width: 2.25rem;
  padding: 0.1875rem 0.3125rem;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: var(--ui-radius-sm);
  color: var(--ui-color-text);
  background: var(--ui-color-surface-raised);
  box-shadow: var(--ui-shadow-sm);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  text-align: center;
  transform: translateX(-50%);
  white-space: nowrap;
}

.ui-horizontal-fader.is-disabled {
  opacity: var(--ui-opacity-disabled);
}

.ui-horizontal-fader.is-disabled input {
  cursor: not-allowed;
}
</style>
