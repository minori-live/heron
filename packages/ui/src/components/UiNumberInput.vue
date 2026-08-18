<script setup lang="ts">
import { NumberFieldInput, NumberFieldRoot } from "reka-ui"

import type { UiControlSize } from "../types"

defineOptions({ inheritAttrs: false })

const model = defineModel<number | null>({ default: null })
const props = withDefaults(
  defineProps<{
    id?: string
    name?: string
    size?: "compact" | UiControlSize
    min?: number
    max?: number
    step?: number
    placeholder?: string
    invalid?: boolean
    disabled?: boolean
    readonly?: boolean
    required?: boolean
  }>(),
  {
    id: undefined,
    name: undefined,
    size: "md",
    min: undefined,
    max: undefined,
    step: 1,
    placeholder: undefined,
    invalid: false,
    disabled: false,
    readonly: false,
    required: false
  }
)
</script>

<template>
  <NumberFieldRoot
    :id="props.id"
    v-model="model"
    class="ui-number-input inline-grid min-w-0"
    :class="`ui-number-input--${props.size}`"
    :name="props.name"
    :min="props.min"
    :max="props.max"
    :step="props.step"
    :disabled="props.disabled"
    :readonly="props.readonly"
    :required="props.required"
    disable-wheel-change
  >
    <NumberFieldInput
      v-bind="$attrs"
      class="ui-number-input__field min-w-0 w-full border border-solid border-ui-border rounded-ui-md bg-ui-control text-ui-text-muted [font-variant-numeric:tabular-nums] transition-[border-color,background] duration-[var(--ui-motion-fast)] ease-[var(--ui-ease-standard)] disabled:cursor-not-allowed"
      :placeholder="props.placeholder"
      :aria-invalid="props.invalid || undefined"
    />
  </NumberFieldRoot>
</template>

<style scoped>
.ui-number-input__field:hover:not(:disabled) {
  border-color: var(--ui-color-border-strong);
  background: var(--ui-color-control);
}

.ui-number-input__field {
  font-family: var(--ui-type-family-data);
}

.ui-number-input__field:focus {
  border-color: var(--ui-color-focus);
}

.ui-number-input__field[aria-invalid="true"] {
  border-color: var(--ui-color-danger);
}

.ui-number-input[data-disabled] {
  opacity: var(--ui-opacity-disabled);
}

.ui-number-input--compact .ui-number-input__field {
  min-height: var(--ui-control-compact);
  padding: 0 var(--ui-space-2);
  border-radius: var(--ui-radius-sm);
  font: var(--ui-type-size-control) var(--ui-type-family-data);
}

.ui-number-input--sm .ui-number-input__field {
  min-height: var(--ui-control-sm);
  padding: 0 var(--ui-space-2);
  font-size: var(--ui-type-size-control);
}

.ui-number-input--md .ui-number-input__field {
  min-height: var(--ui-control-md);
  padding: 0 var(--ui-space-3);
  font-size: var(--ui-type-size-body-compact);
}

.ui-number-input--lg .ui-number-input__field {
  min-height: var(--ui-control-lg);
  padding: 0 var(--ui-space-4);
  font-size: var(--ui-type-size-label);
}
</style>
