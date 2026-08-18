<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string
    density?: "compact" | "standard"
  }>(),
  {
    density: "standard"
  }
)

const densityClasses = {
  compact: "min-h-[var(--ui-control-md)] px-ui-3 py-ui-1",
  standard: "min-h-[var(--ui-control-lg)] px-ui-4 py-ui-2"
} as const
</script>

<template>
  <div
    class="flex min-w-0 items-center gap-ui-2 border-b border-solid border-ui-border bg-ui-surface text-ui-text"
    :class="densityClasses[props.density]"
    :data-density="props.density"
    role="toolbar"
    :aria-label="props.label"
  >
    <div
      v-if="$slots.start"
      class="flex min-w-0 flex-[0_1_auto] items-center gap-ui-2 overflow-x-auto [scrollbar-width:thin]"
    >
      <slot name="start" />
    </div>
    <div
      class="flex min-w-0 flex-[1_1_0] items-center gap-ui-2 overflow-x-auto [scrollbar-width:thin]"
    >
      <slot />
    </div>
    <div v-if="$slots.end" class="ms-auto flex min-w-0 flex-none items-center gap-ui-2">
      <slot name="end" />
    </div>
  </div>
</template>
