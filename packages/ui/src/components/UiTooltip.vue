<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from "reka-ui"

const props = withDefaults(
  defineProps<{
    text: string
    shortcut?: string
    side?: "top" | "right" | "bottom" | "left"
    disabled?: boolean
  }>(),
  {
    shortcut: undefined,
    side: "top",
    disabled: false
  }
)
</script>

<template>
  <TooltipRoot :disabled="props.disabled">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        class="z-[var(--ui-z-tooltip)] inline-flex max-w-[min(22rem,calc(100vw-2rem))] items-center gap-ui-2 border border-solid border-ui-border rounded-ui-sm bg-ui-surface-raised px-ui-3 py-ui-2 text-ui-xs text-ui-text leading-ui-normal shadow-ui-md"
        data-ui-part="tooltip-content"
        :side="props.side"
        :side-offset="6"
      >
        <span>{{ props.text }}</span>
        <kbd v-if="props.shortcut" class="font-ui-interface text-ui-text-muted">{{
          props.shortcut
        }}</kbd>
        <TooltipArrow class="ui-tooltip__arrow" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<style>
.ui-tooltip__arrow {
  fill: var(--ui-color-surface-raised);
}
</style>
