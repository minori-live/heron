<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton } from "@heron/ui"

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    label: string
    tooltip?: string
    pressed?: boolean
    unavailable?: boolean
    disabled?: boolean
    compactHidden?: boolean
    tutorialTarget?: string
    tone?: "default" | "play" | "record" | "accent" | "loop" | "success"
  }>(),
  {
    tooltip: undefined,
    pressed: undefined,
    unavailable: false,
    disabled: false,
    compactHidden: false,
    tutorialTarget: undefined,
    tone: "default"
  }
)
const emit = defineEmits<{
  activate: []
}>()

const tooltipText = computed(() =>
  props.unavailable
    ? `${props.label} · ${t("studio.common.comingSoon")}`
    : (props.tooltip ?? props.label)
)

function activate(): void {
  if (props.unavailable || props.disabled) return
  emit("activate")
}
</script>

<template>
  <UiButton
    size="sm"
    variant="ghost"
    :title="tooltipText"
    :class="[
      'workspace-control-button',
      `tone-${tone}`,
      {
        unavailable,
        'compact-hidden': compactHidden
      }
    ]"
    :disabled="unavailable || disabled"
    :aria-pressed="pressed"
    :aria-label="label"
    :data-placeholder="unavailable ? 'true' : undefined"
    :data-tutorial="tutorialTarget"
    @click="activate"
  >
    <slot />
  </UiButton>
</template>

<style scoped>
.workspace-control-button {
  --control-tone: var(--ui-color-action);
  --control-ink: var(--ui-color-text-subtle);
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  color: var(--control-ink);
  background: transparent;
  -webkit-app-region: no-drag;
}
.workspace-control-button.ui-button--ghost {
  color: var(--control-ink);
}
.workspace-control-button[aria-pressed="true"] {
  color: var(--control-tone);
  background: color-mix(in srgb, var(--control-tone) 20%, transparent);
}
.workspace-control-button.tone-accent {
  --control-ink: var(--ui-color-action);
}
/* Armed recording stays a solid red pad, as on the product website. */
.workspace-control-button.tone-record[aria-pressed="true"] {
  color: var(--ui-domain-signal-ink);
  background: var(--ui-signal-record);
}
.workspace-control-button.tone-play {
  --control-tone: var(--ui-signal-audio);
  --control-ink: var(--ui-signal-audio);
}
.workspace-control-button.tone-record {
  --control-tone: var(--ui-signal-record);
  --control-ink: var(--ui-signal-record);
}
.workspace-control-button.tone-loop {
  --control-tone: var(--ui-signal-loop);
  --control-ink: var(--ui-signal-loop);
}
.workspace-control-button.tone-success {
  --control-tone: var(--ui-color-success);
}
.workspace-control-button.unavailable {
  opacity: 0.48;
  cursor: help;
}
.workspace-control-button:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}
@media (max-width: 1279px) {
  .workspace-control-button.compact-hidden {
    display: none;
  }
}
</style>
