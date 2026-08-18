<script setup lang="ts">
import { PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui"

const open = defineModel<boolean>({ default: false })
const props = withDefaults(
  defineProps<{
    align?: "start" | "center" | "end"
    side?: "top" | "right" | "bottom" | "left"
    sideOffset?: number
    collisionPadding?: number
    modal?: boolean
    contentClass?: string
  }>(),
  {
    align: "center",
    side: "bottom",
    sideOffset: 8,
    collisionPadding: 8,
    modal: false,
    contentClass: undefined
  }
)
</script>

<template>
  <PopoverRoot v-model:open="open" :modal="props.modal">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :class="[
          'z-[var(--ui-z-popover)] max-h-[min(36rem,calc(100dvh-1rem))] max-w-[min(28rem,calc(100vw-1rem))] overflow-auto border border-solid border-ui-border rounded-ui-md bg-ui-surface-raised p-ui-3 text-ui-text shadow-ui-md',
          props.contentClass
        ]"
        :align="props.align"
        :side="props.side"
        :side-offset="props.sideOffset"
        :collision-padding="props.collisionPadding"
      >
        <slot />
        <PopoverArrow class="ui-popover__arrow" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
.ui-popover__arrow {
  fill: var(--ui-color-surface-raised);
}
</style>
