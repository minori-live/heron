<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string
    description?: string
    selected?: boolean
    disabled?: boolean
  }>(),
  {
    description: undefined,
    selected: false,
    disabled: false
  }
)
const emit = defineEmits<{ select: [] }>()
defineSlots<{
  preview(): unknown
  icon(): unknown
  trailing(): unknown
}>()
</script>

<template>
  <button
    type="button"
    class="ui-choice-card"
    :class="{ 'ui-choice-card--selected': props.selected, 'ui-choice-card--icon': $slots.icon }"
    :aria-pressed="props.selected"
    :disabled="props.disabled"
    @click="emit('select')"
  >
    <span v-if="$slots.preview" class="ui-choice-card__preview" aria-hidden="true"
      ><slot name="preview"
    /></span>
    <span v-if="$slots.icon" class="ui-choice-card__icon" aria-hidden="true"
      ><slot name="icon"
    /></span>
    <span class="ui-choice-card__copy">
      <strong>{{ props.label }}</strong>
      <small v-if="props.description">{{ props.description }}</small>
    </span>
    <span class="ui-choice-card__trailing">
      <slot name="trailing"><span class="ui-choice-card__indicator" aria-hidden="true" /></slot>
    </span>
  </button>
</template>

<style scoped>
.ui-choice-card {
  display: grid;
  width: 100%;
  min-height: var(--ui-control-lg);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  color: var(--ui-color-text-muted);
  background: transparent;
  text-align: start;
  font: var(--ui-type-size-body-compact) / var(--ui-type-leading-compact)
    var(--ui-type-family-interface);
  cursor: pointer;
}

.ui-choice-card:hover:not(:disabled):not([aria-pressed="true"]) {
  border-color: var(--ui-color-border-strong);
  color: var(--ui-color-text);
  background: var(--ui-color-surface-hover);
}

.ui-choice-card--selected {
  border-color: var(--ui-color-action);
  color: var(--ui-color-text);
  background: var(--ui-color-selection);
  box-shadow: inset 0 0 0 1px var(--ui-color-action);
}

.ui-choice-card__preview {
  display: grid;
  grid-column: 1 / -1;
  min-width: 0;
  margin-bottom: 4px;
}

.ui-choice-card--icon {
  grid-template-columns: 16px minmax(0, 1fr) auto;
}

.ui-choice-card__icon {
  display: grid;
  place-items: center;
  margin-top: 1px;
  color: var(--ui-color-action);
}

.ui-choice-card__trailing {
  display: grid;
  align-items: start;
  padding-top: 4px;
}

.ui-choice-card__indicator {
  width: 7px;
  height: 7px;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 50%;
  background: transparent;
}

.ui-choice-card--selected .ui-choice-card__indicator {
  border-color: var(--ui-color-action);
  background: var(--ui-color-action);
}

.ui-choice-card:focus-visible {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: 2px;
}

.ui-choice-card:disabled {
  cursor: not-allowed;
  opacity: var(--ui-opacity-disabled);
}

.ui-choice-card__copy,
.ui-choice-card__copy > * {
  display: block;
  min-width: 0;
}

.ui-choice-card__copy small {
  margin-top: var(--ui-space-1);
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
  font-weight: var(--ui-type-weight-regular);
}

.ui-choice-card__copy {
  overflow-wrap: anywhere;
}

.ui-choice-card__copy strong {
  font-size: var(--ui-type-size-body-compact);
}
</style>
