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
</script>

<template>
  <button
    type="button"
    class="ui-choice-card"
    :class="{ 'ui-choice-card--selected': props.selected }"
    :aria-pressed="props.selected"
    :disabled="props.disabled"
    @click="emit('select')"
  >
    <span v-if="$slots.icon" class="ui-choice-card__icon" aria-hidden="true"
      ><slot name="icon"
    /></span>
    <span class="ui-choice-card__copy">
      <strong>{{ props.label }}</strong>
      <small v-if="props.description">{{ props.description }}</small>
    </span>
    <slot name="trailing" />
  </button>
</template>

<style scoped>
.ui-choice-card {
  display: grid;
  width: 100%;
  min-height: var(--ui-control-lg);
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-3);
  padding: var(--ui-space-3);
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  color: var(--ui-color-text-muted);
  background: transparent;
  text-align: start;
  cursor: pointer;
}

.ui-choice-card:hover:not(:disabled) {
  border-color: var(--ui-color-border-strong);
  color: var(--ui-color-text);
  background: var(--ui-color-surface-hover);
}

.ui-choice-card--selected {
  border-color: var(--ui-color-action);
  color: var(--ui-color-text);
  background: var(--ui-color-selection);
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
}
</style>
