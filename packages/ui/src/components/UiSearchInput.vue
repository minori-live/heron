<script setup lang="ts">
const model = defineModel<string>({ default: "" })
const props = withDefaults(
  defineProps<{
    label: string
    placeholder?: string
    disabled?: boolean
  }>(),
  { placeholder: undefined, disabled: false }
)
</script>

<template>
  <label class="ui-search-input" :class="{ 'ui-search-input--disabled': props.disabled }">
    <svg class="ui-search-input__icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="7.5" />
      <path d="m16 16 5 5" />
    </svg>
    <input
      v-model="model"
      type="search"
      :aria-label="props.label"
      :placeholder="props.placeholder ?? props.label"
      :disabled="props.disabled"
    />
  </label>
</template>

<style scoped>
.ui-search-input {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: 27px;
  padding: 0 7px;
  border: 1px solid var(--line-strong);
  border-radius: var(--ui-radius-sm);
  color: var(--text-faint);
  background: var(--daw-control);
}
.ui-search-input:focus-within {
  border-color: var(--focus);
  box-shadow: inset 0 0 0 1px var(--focus);
}
.ui-search-input__icon {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}
.ui-search-input input {
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: 0;
  box-shadow: none;
  appearance: none;
  color: var(--text-primary);
  background: transparent;
  font: var(--ui-type-size-control) / var(--ui-type-leading-normal) var(--ui-type-family-interface);
}
.ui-search-input input::placeholder {
  color: var(--text-faint);
  opacity: 1;
}
.ui-search-input input::-webkit-search-cancel-button {
  display: none;
}
.ui-search-input--disabled {
  opacity: var(--ui-opacity-disabled);
}
</style>
