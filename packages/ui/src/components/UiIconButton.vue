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
  }>(),
  {
    tooltip: undefined,
    variant: "ghost",
    size: "md",
    loading: false,
    disabled: false,
    pressed: undefined,
    stopPropagation: false,
    density: "standard"
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
      :class="[sizeClasses[props.size], { 'ui-icon-button--compact': props.density === 'compact' }]"
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
.ui-button.ui-icon-button--compact {
  width: 1.125rem;
  min-width: 1.125rem;
  height: 1.25rem;
  min-height: 1.25rem;
  padding: 0;
  border-radius: var(--ui-radius-sm);
}
</style>
