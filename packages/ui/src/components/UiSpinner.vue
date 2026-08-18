<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label?: string
    size?: "sm" | "md" | "lg"
  }>(),
  {
    label: "Loading",
    size: "md"
  }
)

const sizeClasses = {
  sm: "h-3.5 w-3.5",
  md: "h-[1.125rem] w-[1.125rem]",
  lg: "h-6 w-6"
} as const
</script>

<template>
  <span
    class="inline-grid flex-none place-items-center text-current"
    :class="sizeClasses[props.size]"
    :data-size="props.size"
    role="status"
  >
    <span class="ui-spinner__ring" aria-hidden="true" />
    <span class="ui-visually-hidden">{{ props.label }}</span>
  </span>
</template>

<style scoped>
.ui-spinner__ring {
  width: 100%;
  height: 100%;
  border: 2px solid color-mix(in srgb, currentColor 28%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: ui-spinner-rotate 720ms linear infinite;
}

@keyframes ui-spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
