<script setup lang="ts">
import { useId } from "vue"

const model = defineModel<boolean>({ default: false })
const props = withDefaults(
  defineProps<{
    label: string
    description?: string
    disabled?: boolean
    id?: string
  }>(),
  {
    description: undefined,
    disabled: false,
    id: undefined
  }
)

const generatedId = useId()
const controlId = props.id ?? `ui-checkbox-${generatedId}`
</script>

<template>
  <label
    class="ui-checkbox inline-flex min-w-0 items-start gap-ui-2 text-ui-text-muted"
    :class="
      props.disabled ? 'cursor-not-allowed opacity-[var(--ui-opacity-disabled)]' : 'cursor-pointer'
    "
  >
    <input
      :id="controlId"
      v-model="model"
      class="ui-checkbox__input"
      type="checkbox"
      :disabled="props.disabled"
    />
    <span class="ui-checkbox__indicator" aria-hidden="true">
      <svg viewBox="0 0 12 12">
        <path d="m2.5 6.2 2.1 2.1 4.9-5" />
      </svg>
    </span>
    <span class="grid gap-ui-1 leading-ui-normal">
      <span class="ui-checkbox__label">{{ props.label }}</span>
      <span v-if="props.description" class="ui-checkbox__description">
        {{ props.description }}
      </span>
    </span>
  </label>
</template>

<style scoped>
.ui-checkbox {
  position: relative;
  font-family: var(--ui-type-family-data);
}

.ui-checkbox__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.ui-checkbox__indicator {
  display: grid;
  width: 0.875rem;
  height: 0.875rem;
  flex: none;
  margin-top: 1px;
  place-items: center;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: var(--ui-radius-sm);
  color: var(--ui-color-action-text);
  background: var(--ui-color-control);
  transition:
    border-color var(--ui-motion-fast) var(--ui-ease-standard),
    background-color var(--ui-motion-fast) var(--ui-ease-standard);
}

.ui-checkbox:hover .ui-checkbox__indicator {
  border-color: var(--ui-color-text-subtle);
  background: var(--ui-color-control-hover);
}

.ui-checkbox__input:focus-visible + .ui-checkbox__indicator {
  outline: var(--ui-focus-width) solid var(--ui-color-focus);
  outline-offset: 2px;
}

.ui-checkbox__input:checked + .ui-checkbox__indicator {
  border-color: var(--ui-color-action);
  background: var(--ui-color-action);
}

.ui-checkbox__indicator svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  opacity: 0;
}

.ui-checkbox__input:checked + .ui-checkbox__indicator svg {
  opacity: 1;
}

.ui-checkbox__label {
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-body-compact);
  font-weight: var(--ui-type-weight-semibold);
}

.ui-checkbox__description {
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-caption);
}
</style>
