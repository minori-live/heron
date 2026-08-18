<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    as?: "div" | "section" | "article" | "aside"
    level?: "base" | "raised" | "canvas"
    padding?: "none" | "sm" | "md" | "lg"
  }>(),
  {
    as: "section",
    level: "base",
    padding: "md"
  }
)

const levelClasses = {
  base: "bg-ui-surface",
  raised: "bg-ui-surface-raised shadow-ui-sm",
  canvas: "bg-ui-canvas-subtle"
} as const

const paddingClasses = {
  none: "p-ui-0",
  sm: "p-ui-3",
  md: "p-ui-5",
  lg: "p-ui-8"
} as const
</script>

<template>
  <component
    :is="props.as"
    class="min-w-0 border border-solid border-ui-border rounded-ui-lg bg-ui-surface text-ui-text"
    :class="[levelClasses[props.level], paddingClasses[props.padding]]"
    :data-level="props.level"
    :data-padding="props.padding"
  >
    <slot />
  </component>
</template>
