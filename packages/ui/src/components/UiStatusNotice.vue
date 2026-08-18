<script setup lang="ts">
import type { UiNoticeTone } from "../types"

const props = withDefaults(
  defineProps<{
    title?: string
    tone?: UiNoticeTone
    live?: "off" | "polite" | "assertive"
  }>(),
  {
    title: undefined,
    tone: "neutral",
    live: "off"
  }
)

const markerClasses = {
  neutral: "bg-ui-text-muted",
  info: "bg-ui-info",
  success: "bg-ui-success",
  warning: "bg-ui-warning",
  danger: "bg-ui-danger"
} as const
</script>

<template>
  <div
    class="flex min-w-0 items-start gap-ui-3 border border-solid border-ui-border rounded-ui-md bg-ui-surface-raised px-ui-4 py-ui-3 text-ui-text"
    :data-tone="props.tone"
    :role="props.live === 'assertive' ? 'alert' : props.live === 'polite' ? 'status' : undefined"
    :aria-live="props.live === 'off' ? undefined : props.live"
  >
    <span
      class="mt-[0.35rem] h-[0.625rem] w-[0.625rem] flex-none rounded-full"
      :class="markerClasses[props.tone]"
      aria-hidden="true"
    />
    <div class="grid min-w-0 gap-ui-1 text-ui-sm leading-ui-normal">
      <strong v-if="props.title" class="font-600">{{ props.title }}</strong>
      <div class="text-ui-text-muted"><slot /></div>
    </div>
  </div>
</template>
