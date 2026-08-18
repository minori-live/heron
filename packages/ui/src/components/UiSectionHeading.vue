<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    level?: 1 | 2 | 3 | 4
  }>(),
  {
    description: undefined,
    level: 2
  }
)
</script>

<template>
  <header class="ui-section-heading flex min-w-0 items-start justify-between gap-ui-4">
    <div class="grid min-w-0 gap-ui-2">
      <component
        :is="`h${props.level}`"
        class="m-0 text-ui-lg font-600 text-ui-text leading-ui-tight"
      >
        {{ props.title }}
      </component>
      <p
        v-if="props.description"
        class="m-0 max-w-[48rem] text-ui-sm text-ui-text-muted leading-ui-normal"
      >
        {{ props.description }}
      </p>
    </div>
    <div
      v-if="$slots.actions"
      class="ui-section-heading__actions flex flex-none flex-wrap gap-ui-2"
    >
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
@media (max-width: 30rem) {
  .ui-section-heading {
    flex-direction: column;
  }

  .ui-section-heading__actions {
    width: 100%;
  }
}
</style>
