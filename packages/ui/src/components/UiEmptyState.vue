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
      class="grid h-12 w-12 place-items-center border border-solid border-ui-border rounded-full bg-ui-surface-raised text-ui-text-muted"
      aria-hidden="true"
    >
      <slot name="icon" />
    </div>
    <div class="grid max-w-[34rem] gap-ui-2">
      <h2 class="m-0 text-ui-lg text-ui-text leading-ui-normal">{{ props.title }}</h2>
      <p v-if="props.description" class="m-0 text-ui-sm text-ui-text-muted leading-ui-normal">
        {{ props.description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap justify-center gap-ui-3">
      <slot name="actions" />
    </div>
  </div>
</template>
