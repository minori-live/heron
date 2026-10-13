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
    class="ui-status-notice flex min-w-0 items-start gap-ui-3 border border-solid rounded-ui-lg px-ui-4 py-ui-3 text-ui-text"
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
      <strong v-if="props.title" class="font-650">{{ props.title }}</strong>
      <div class="text-ui-text-muted"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.ui-status-notice {
  --notice-tone: var(--ui-color-text-muted);

  border-color: color-mix(in srgb, var(--notice-tone) 22%, transparent);
  background: color-mix(in srgb, var(--notice-tone) 10%, transparent);
}

.ui-status-notice[data-tone="neutral"] {
  border-color: var(--ui-color-glass-edge);
  background: var(--ui-color-fill);
}

.ui-status-notice[data-tone="info"] {
  --notice-tone: var(--ui-color-info);
}

.ui-status-notice[data-tone="success"] {
  --notice-tone: var(--ui-color-success);
}

.ui-status-notice[data-tone="warning"] {
  --notice-tone: var(--ui-color-warning);
}

.ui-status-notice[data-tone="danger"] {
  --notice-tone: var(--ui-color-danger);
}
</style>
