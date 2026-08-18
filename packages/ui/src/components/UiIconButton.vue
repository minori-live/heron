<script setup lang="ts">
import type { UiActionVariant, UiControlSize } from "../types"
import UiButton from "./UiButton.vue"
import UiTooltip from "./UiTooltip.vue"

const props = withDefaults(
  defineProps<{
    label: string
    tooltip?: string
    variant?: UiActionVariant
    size?: UiControlSize
    loading?: boolean
    disabled?: boolean
    pressed?: boolean
  }>(),
  {
    tooltip: undefined,
    variant: "ghost",
    size: "md",
    loading: false,
    disabled: false,
    pressed: undefined
  }
)

const sizeClasses = {
  sm: "min-w-[var(--ui-control-sm)] w-[var(--ui-control-sm)] p-0",
  md: "min-w-[var(--ui-control-md)] w-[var(--ui-control-md)] p-0",
  lg: "min-w-[var(--ui-control-lg)] w-[var(--ui-control-lg)] p-0"
} as const
</script>

<template>
  <UiTooltip :text="props.tooltip ?? props.label">
    <UiButton
      :class="sizeClasses[props.size]"
      :variant="props.variant"
      :size="props.size"
      :loading="props.loading"
      :disabled="props.disabled"
      :aria-label="props.label"
      :aria-pressed="props.pressed"
    >
      <slot />
    </UiButton>
  </UiTooltip>
</template>
