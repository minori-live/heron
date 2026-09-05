<script setup lang="ts">
import { useAttrs } from "vue"
import type { UiActionVariant, UiControlSize } from "../types"
import UiButton from "./UiButton.vue"
import UiTooltip from "./UiTooltip.vue"

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    label: string
    tooltip?: string
    variant?: UiActionVariant
    size?: UiControlSize
    loading?: boolean
    disabled?: boolean
    pressed?: boolean
    stopPropagation?: boolean
    density?: "standard" | "compact"
    appearance?: "default" | "workspace"
    pressedTone?: "neutral" | "success"
  }>(),
  {
    tooltip: undefined,
    variant: "ghost",
    size: "md",
    loading: false,
    disabled: false,
    pressed: undefined,
    stopPropagation: false,
    density: "standard",
    appearance: "default",
    pressedTone: "neutral"
  }
)
const emit = defineEmits<{ click: [] }>()
const attrs = useAttrs()

function activate(nativeEvent?: unknown): void {
  if (nativeEvent instanceof MouseEvent) {
    ;(emit as unknown as (name: "click", event: MouseEvent) => void)("click", nativeEvent)
  } else {
    emit("click")
  }
}

const sizeClasses = {
  sm: "min-w-[var(--ui-control-sm)] w-[var(--ui-control-sm)] p-0",
  md: "min-w-[var(--ui-control-md)] w-[var(--ui-control-md)] p-0",
  lg: "min-w-[var(--ui-control-lg)] w-[var(--ui-control-lg)] p-0"
} as const
</script>

<template>
  <UiTooltip :text="props.tooltip ?? props.label">
    <UiButton
      v-bind="attrs"
      :class="[
        sizeClasses[props.size],
        {
          'ui-icon-button--compact': props.density === 'compact',
          'ui-icon-button--workspace': props.appearance === 'workspace',
          'ui-icon-button--success': props.pressedTone === 'success'
        }
      ]"
      :variant="props.variant"
      :size="props.size"
      :loading="props.loading"
      :disabled="props.disabled"
      :aria-label="props.label"
      :aria-pressed="props.pressed"
      :stop-propagation="props.stopPropagation"
      @click="activate"
    >
      <slot />
    </UiButton>
  </UiTooltip>
</template>

<style>
.ui-button.ui-icon-button--workspace {
  --icon-button-signal: var(--accent);

  display: grid;
  place-items: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid var(--ui-domain-color-747474);
  border-radius: var(--ui-radius-sm);
  color: var(--text-muted);
  background: var(--daw-control);
}

.ui-button.ui-icon-button--workspace.ui-icon-button--success {
  --icon-button-signal: var(--ui-color-success);
}

.ui-button.ui-icon-button--workspace:hover:not(:disabled):not([aria-pressed="true"]) {
  border-color: var(--line-strong);
  background: var(--daw-control-hover);
}

.ui-button.ui-icon-button--workspace[aria-pressed="true"],
.ui-button.ui-icon-button--workspace[aria-pressed="true"]:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--icon-button-signal) 62%, var(--ui-domain-color-747474));
  color: var(--icon-button-signal);
  background: color-mix(in srgb, var(--icon-button-signal) 14%, var(--surface-active));
  box-shadow:
    0 -2px 0 var(--icon-button-signal) inset,
    0 0 9px color-mix(in srgb, var(--icon-button-signal) 18%, transparent);
}

.ui-button.ui-icon-button--workspace:disabled {
  opacity: var(--ui-opacity-disabled);
}

.ui-button.ui-icon-button--compact {
  width: 1.125rem;
  min-width: 1.125rem;
  height: 1.25rem;
  min-height: 1.25rem;
  padding: 0;
  border-radius: var(--ui-radius-sm);
}
</style>
