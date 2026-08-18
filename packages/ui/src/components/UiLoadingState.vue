<script setup lang="ts">
import UiProgress from "./UiProgress.vue"
import UiSpinner from "./UiSpinner.vue"

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    value?: number | null
    max?: number
  }>(),
  {
    description: undefined,
    value: undefined,
    max: 100
  }
)
</script>

<template>
  <div
    class="grid min-w-0 place-items-center gap-ui-4 p-ui-8 text-center text-ui-text"
    role="status"
    aria-live="polite"
  >
    <UiSpinner v-if="props.value === undefined" size="lg" :label="props.title" />
    <div class="grid gap-ui-2">
      <strong class="text-ui-lg leading-ui-normal">{{ props.title }}</strong>
      <p
        v-if="props.description"
        class="m-0 max-w-[34rem] text-ui-sm text-ui-text-muted leading-ui-normal"
      >
        {{ props.description }}
      </p>
    </div>
    <UiProgress
      v-if="props.value !== undefined"
      :value="props.value"
      :max="props.max"
      :label="props.title"
    />
  </div>
</template>
