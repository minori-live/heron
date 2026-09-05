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
    appearance?: "default" | "workspace"
    suffix?: string
    accentColor?: string
    formatOptions?: Intl.NumberFormatOptions
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
    appearance: "default",
    suffix: undefined,
    accentColor: undefined,
    formatOptions: undefined,
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
    :class="[
      `ui-number-input--${props.size}`,
      {
        'ui-number-input--workspace': props.appearance === 'workspace',
        'ui-number-input--suffix': props.suffix
      }
    ]"
    :style="{ '--number-input-accent': props.accentColor }"
    :data-invalid="props.invalid || undefined"
    :name="props.name"
    :min="props.min"
    :max="props.max"
    :step="props.step"
    :format-options="props.formatOptions"
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
    <span v-if="props.suffix" class="ui-number-input__suffix" aria-hidden="true">{{
      props.suffix
    }}</span>
  </NumberFieldRoot>
</template>

<style scoped>
.ui-number-input:not(.ui-number-input--workspace):not(.ui-number-input--suffix)
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

.ui-number-input--workspace,
.ui-number-input--suffix {
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-color-control);
}

.ui-number-input--suffix {
  grid-template-columns: minmax(0, 1fr) auto;
}

.ui-number-input--workspace .ui-number-input__field,
.ui-number-input--suffix .ui-number-input__field {
  border: 0;
  border-radius: inherit;
  background: transparent;
  outline: none;
  box-shadow: none;
}

.ui-number-input--workspace {
  border-color: var(--line-soft, var(--ui-color-border));
  background: var(--surface-sunken, var(--ui-color-control));
}

.ui-number-input--workspace .ui-number-input__field {
  padding: 0 5px;
  color: var(--text-primary, var(--ui-color-text));
}

.ui-number-input--workspace.ui-number-input--compact {
  height: 23px;
}

.ui-number-input--workspace.ui-number-input--compact .ui-number-input__field {
  min-height: 0;
  height: 100%;
}

.ui-number-input--workspace.ui-number-input--compact.ui-number-input--suffix {
  height: 25px;
}

.ui-number-input--workspace.ui-number-input--suffix .ui-number-input__field {
  padding: 0 6px;
  font-size: var(--ui-type-size-body-compact);
}

.ui-number-input__suffix {
  display: grid;
  place-items: center;
  min-width: 28px;
  padding: 0 3px;
  border-left: 1px solid var(--line-soft, var(--ui-color-border));
  color: var(--number-input-accent, var(--ui-color-text-muted));
  font: var(--ui-type-weight-bold) var(--ui-type-size-micro) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
}

.ui-number-input--workspace:focus-within,
.ui-number-input--suffix:focus-within {
  border-color: var(--number-input-accent, var(--ui-color-focus));
  box-shadow: 0 0 0 1px
    color-mix(in srgb, var(--number-input-accent, var(--ui-color-focus)) 22%, transparent);
}

.ui-number-input[data-invalid] {
  border-color: var(--ui-color-danger);
}
</style>
