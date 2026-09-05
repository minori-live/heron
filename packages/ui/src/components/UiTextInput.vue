<script setup lang="ts">
import { useAttrs, useTemplateRef } from "vue"

import type { UiControlSize } from "../types"

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: "", set: (value) => String(value) })
const props = withDefaults(
  defineProps<{
    size?: UiControlSize
    invalid?: boolean
  }>(),
  {
    size: "md",
    invalid: false
  }
)
const attrs = useAttrs()
const input = useTemplateRef<HTMLInputElement>("input")

defineExpose({
  focus: () => input.value?.focus(),
  select: () => input.value?.select()
})

const sizeClasses = {
  sm: "min-h-[var(--ui-control-sm)] px-ui-2 text-[var(--ui-type-size-control)]",
  md: "min-h-[var(--ui-control-md)] px-ui-3 text-[var(--ui-type-size-body-compact)]",
  lg: "min-h-[var(--ui-control-lg)] px-ui-4 text-[var(--ui-type-size-label)]"
} as const
</script>

<template>
  <input
    ref="input"
    v-bind="attrs"
    v-model="model"
    class="ui-input min-w-0 w-full border border-solid border-ui-border rounded-ui-md bg-ui-control font-ui-data text-ui-text-muted leading-ui-normal transition-[border-color,background] duration-[var(--ui-motion-fast)] ease-[var(--ui-ease-standard)] disabled:cursor-not-allowed disabled:opacity-[var(--ui-opacity-disabled)]"
    :class="sizeClasses[props.size]"
    :aria-invalid="props.invalid || undefined"
  />
</template>

<style scoped>
.ui-input:hover:not(:disabled) {
  border-color: var(--ui-color-border-strong);
}

.ui-input:focus {
  border-color: var(--ui-color-focus);
}

.ui-input[aria-invalid="true"] {
  border-color: var(--ui-color-danger);
}
</style>
