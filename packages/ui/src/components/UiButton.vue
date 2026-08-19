<script setup lang="ts">
import { useAttrs } from "vue"

import type { UiActionVariant, UiControlSize } from "../types"
import UiSpinner from "./UiSpinner.vue"

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    variant?: UiActionVariant
    size?: UiControlSize
    loading?: boolean
    disabled?: boolean
    type?: "button" | "submit" | "reset"
    loadingLabel?: string
    stopPropagation?: boolean
  }>(),
  {
    variant: "secondary",
    size: "md",
    loading: false,
    disabled: false,
    type: "button",
    loadingLabel: "Loading",
    stopPropagation: false
  }
)
const emit = defineEmits<{ click: [] }>()

const attrs = useAttrs()

function activate(event: MouseEvent): void {
  if (props.stopPropagation) event.stopPropagation()
  // Headless trigger adapters need the native event at runtime, while the public
  // component contract intentionally exposes a payload-free user intent.
  ;(emit as unknown as (name: "click", nativeEvent: MouseEvent) => void)("click", event)
}

function stopPointer(event: PointerEvent): void {
  if (props.stopPropagation) event.stopPropagation()
}

const sizeClasses = {
  sm: "min-h-[var(--ui-control-sm)] px-ui-3 text-ui-xs",
  md: "min-h-[var(--ui-control-md)] px-ui-4 text-ui-sm",
  lg: "min-h-[var(--ui-control-lg)] px-ui-5 text-ui-md"
} as const
</script>

<template>
  <button
    v-bind="attrs"
    class="ui-button ui-inline-center min-w-0 min-h-[var(--ui-target-min)] cursor-pointer gap-ui-2 border border-solid border-transparent rounded-ui-md font-600 leading-ui-tight text-center [overflow-wrap:anywhere] transition-[color,background,border-color] duration-[var(--ui-motion-fast)] ease-[var(--ui-ease-standard)] disabled:cursor-not-allowed disabled:opacity-[var(--ui-opacity-disabled)]"
    :class="[`ui-button--${props.variant}`, sizeClasses[props.size]]"
    :data-variant="props.variant"
    :data-size="props.size"
    :type="props.type"
    :disabled="props.disabled || props.loading"
    :aria-disabled="props.disabled || props.loading || undefined"
    :aria-busy="props.loading || undefined"
    @pointerdown="stopPointer"
    @click="activate"
  >
    <UiSpinner v-if="props.loading" size="sm" :label="props.loadingLabel" />
    <span class="ui-button__content"><slot /></span>
  </button>
</template>

<style scoped>
.ui-button--primary {
  color: var(--ui-color-action-text);
  background: var(--ui-color-action);
}

.ui-button--primary:hover:not(:disabled) {
  background: var(--ui-color-action-hover);
}

.ui-button--primary:active:not(:disabled) {
  background: var(--ui-color-action-pressed);
}

.ui-button--secondary {
  color: var(--ui-color-text);
  background: var(--ui-color-surface-raised);
  border-color: var(--ui-color-border);
}

.ui-button--secondary:hover:not(:disabled),
.ui-button--ghost:hover:not(:disabled) {
  background: var(--ui-color-surface-hover);
  border-color: var(--ui-color-border-strong);
}

.ui-button--ghost {
  color: var(--ui-color-text-muted);
  background: transparent;
}

.ui-button--plain {
  color: inherit;
  background: transparent;
}

.ui-button--plain:hover:not(:disabled) {
  border-color: transparent;
  color: inherit;
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.ui-button--danger {
  color: var(--ui-color-danger-text);
  background: var(--ui-color-danger);
}

.ui-button--danger:hover:not(:disabled) {
  background: var(--ui-color-danger-hover);
}

.ui-button--danger-ghost {
  color: inherit;
  background: transparent;
}

.ui-button--danger-ghost:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ui-color-danger) 45%, transparent);
  color: var(--ui-color-danger-text);
  background: color-mix(in srgb, var(--ui-color-danger) 42%, transparent);
}

.ui-button__content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: inherit;
}
</style>
