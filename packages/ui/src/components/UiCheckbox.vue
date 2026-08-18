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
    class="inline-flex min-w-0 items-start gap-ui-3 text-ui-text"
    :class="
      props.disabled ? 'cursor-not-allowed opacity-[var(--ui-opacity-disabled)]' : 'cursor-pointer'
    "
  >
    <input
      :id="controlId"
      v-model="model"
      class="mt-[0.125rem] h-5 w-5 flex-none [accent-color:var(--ui-color-action)]"
      type="checkbox"
      :disabled="props.disabled"
    />
    <span class="grid gap-ui-1 leading-ui-normal">
      <span class="text-ui-sm font-500">{{ props.label }}</span>
      <span v-if="props.description" class="text-ui-xs text-ui-text-muted">
        {{ props.description }}
      </span>
    </span>
  </label>
</template>
