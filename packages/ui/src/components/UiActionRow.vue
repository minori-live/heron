<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string
    description?: string
    selected?: boolean
    disabled?: boolean
    density?: "standard" | "compact"
    appearance?: "outlined" | "plain"
  }>(),
  {
    description: undefined,
    selected: false,
    disabled: false,
    density: "standard",
    appearance: "outlined"
  }
)
const emit = defineEmits<{ activate: [] }>()
</script>

<template>
  <button
    type="button"
    class="ui-action-row"
    :class="[
      `ui-action-row--${props.density}`,
      `ui-action-row--${props.appearance}`,
      { 'ui-action-row--selected': props.selected }
    ]"
    :aria-current="props.selected ? 'true' : undefined"
    :disabled="props.disabled"
    @click="emit('activate')"
  >
    <span v-if="$slots.leading" class="ui-action-row__leading"><slot name="leading" /></span>
    <span class="ui-action-row__copy">
      <strong>{{ props.label }}</strong>
      <small v-if="props.description">{{ props.description }}</small>
    </span>
    <span v-if="$slots.trailing" class="ui-action-row__trailing"><slot name="trailing" /></span>
  </button>
</template>

<style scoped>
.ui-action-row {
  display: grid;
  width: 100%;
  min-height: var(--ui-control-lg);
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-3);
  padding: var(--ui-space-3);
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  color: var(--ui-color-text);
  background: transparent;
  text-align: start;
  cursor: pointer;
}

.ui-action-row:hover:not(:disabled),
.ui-action-row--selected {
  border-color: var(--ui-color-border-strong);
  background: var(--ui-color-surface-hover);
}

.ui-action-row--plain {
  border-color: transparent;
}

.ui-action-row--compact {
  min-height: 1.75rem;
  gap: var(--ui-space-2);
  padding: 0.4375rem 0.5rem;
  border-radius: var(--ui-radius-sm);
}

.ui-action-row--compact .ui-action-row__copy strong {
  overflow: hidden;
  font-size: var(--ui-type-size-control);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-action-row--compact .ui-action-row__copy small {
  margin-top: 0.1875rem;
  overflow: hidden;
  color: var(--ui-color-text-subtle);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-action-row--compact .ui-action-row__trailing {
  color: var(--ui-color-action);
  font: var(--ui-type-weight-bold) var(--ui-type-size-micro) var(--ui-type-family-data);
}

.ui-action-row:disabled {
  cursor: not-allowed;
  opacity: var(--ui-opacity-disabled);
}

.ui-action-row__copy,
.ui-action-row__copy > * {
  display: block;
  min-width: 0;
}

.ui-action-row__copy small {
  margin-top: var(--ui-space-1);
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
}
</style>
