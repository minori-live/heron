<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string
    description?: string
  }>(),
  {
    description: undefined
  }
)
</script>

<template>
  <div class="grid min-w-0 place-items-center gap-ui-4 p-ui-8 text-center">
    <div
      v-if="$slots.icon"
      class="grid h-12 w-12 place-items-center border border-solid [border-color:var(--ui-color-glass-edge)] rounded-full bg-[var(--ui-color-fill)] text-ui-text-muted"
      aria-hidden="true"
    >
      <slot name="icon" />
    </div>
    <div class="grid max-w-[34rem] gap-ui-2">
      <h2
        class="m-0 text-ui-lg font-ui-display font-750 tracking-[var(--ui-type-tracking-display)] text-ui-text leading-ui-tight [text-wrap:balance]"
      >
        {{ props.title }}
      </h2>
      <p v-if="props.description" class="m-0 text-ui-sm text-ui-text-muted leading-ui-normal">
        {{ props.description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap justify-center gap-ui-3">
      <slot name="actions" />
    </div>
  </div>
</template>
