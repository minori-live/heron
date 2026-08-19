<script setup lang="ts">
import { injectTooltipProviderContext, TooltipProvider } from "reka-ui"

import UiTooltipContent from "./internal/UiTooltipContent.vue"

const open = defineModel<boolean>("open", { default: false })

const props = withDefaults(
  defineProps<{
    text: string
    shortcut?: string
    side?: "top" | "right" | "bottom" | "left"
    disabled?: boolean
    delayDuration?: number
    defaultOpen?: boolean
  }>(),
  {
    shortcut: undefined,
    side: "top",
    disabled: false,
    delayDuration: undefined,
    defaultOpen: false
  }
)

const needsProvider = injectTooltipProviderContext(null) === null
</script>

<template>
  <TooltipProvider v-if="needsProvider">
    <UiTooltipContent v-bind="props" v-model:open="open">
      <slot />
    </UiTooltipContent>
  </TooltipProvider>
  <UiTooltipContent v-else v-bind="props" v-model:open="open">
    <slot />
  </UiTooltipContent>
</template>

<style>
.ui-tooltip__arrow {
  fill: var(--ui-color-surface-raised);
}
</style>
