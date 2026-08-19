<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ required: true })
const props = withDefaults(
  defineProps<{
    label: string
    disabled?: boolean
  }>(),
  { disabled: false }
)
const attrs = useAttrs()
</script>

<template>
  <input
    v-bind="attrs"
    v-model="model"
    class="ui-color-input"
    type="color"
    :aria-label="props.label"
    :disabled="props.disabled"
  />
</template>

<style scoped>
.ui-color-input {
  box-sizing: border-box;
  width: var(--ui-control-md);
  height: var(--ui-control-md);
  padding: 2px;
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-color-control);
  cursor: pointer;
}

.ui-color-input:hover:not(:disabled) {
  border-color: var(--ui-color-border-strong);
}

.ui-color-input:disabled {
  cursor: not-allowed;
  opacity: var(--ui-opacity-disabled);
}
</style>
