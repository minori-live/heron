<script setup lang="ts">
import type { UiJoinedPosition, UiMixerStateButtonSize, UiMixerStateButtonTone } from "../types"

const props = withDefaults(
  defineProps<{
    label: string
    title?: string
    tone?: UiMixerStateButtonTone
    size?: UiMixerStateButtonSize
    pressed?: boolean
    active?: boolean
    joined?: UiJoinedPosition
    disabled?: boolean
    stopPropagation?: boolean
  }>(),
  {
    title: undefined,
    tone: "neutral",
    size: "standard",
    pressed: undefined,
    active: undefined,
    joined: undefined,
    disabled: false,
    stopPropagation: false
  }
)

const emit = defineEmits<{ click: [] }>()

function activate(event: MouseEvent): void {
  if (props.stopPropagation) event.stopPropagation()
  emit("click")
}
</script>

<template>
  <button
    type="button"
    :class="[
      'ui-mixer-state-button',
      `tone-${tone}`,
      `size-${size}`,
      joined && `joined-${joined}`,
      { active: active ?? pressed }
    ]"
    :aria-label="label"
    :aria-pressed="pressed"
    :title
    :disabled
    @click="activate"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-mixer-state-button {
  --mixer-state-button-tone: var(--ui-color-text-muted);
  display: grid;
  width: 2.125rem;
  height: 1.5625rem;
  place-items: center;
  padding: 0;
  border: 1px solid var(--ui-color-glass-edge);
  border-radius: var(--ui-radius-sm);
  color: color-mix(in srgb, var(--mixer-state-button-tone) 78%, var(--ui-color-text-muted));
  background: var(--ui-color-fill);
  font: var(--ui-type-weight-bold) var(--ui-type-size-body-compact) var(--ui-type-family-interface);
  cursor: pointer;
  transition:
    color var(--ui-motion-fast) var(--ui-ease-standard),
    background-color var(--ui-motion-fast) var(--ui-ease-standard),
    border-color var(--ui-motion-fast) var(--ui-ease-standard);
}

.ui-mixer-state-button:not(.active):not(:disabled):hover {
  background: var(--ui-color-fill-hover);
}

.ui-mixer-state-button.size-narrow {
  width: 1.3125rem;
  height: 1.1875rem;
  font-size: var(--ui-type-size-control);
}

.ui-mixer-state-button.size-track {
  width: 17px;
  height: 17px;
  border-radius: var(--ui-radius-xs);
  font-size: var(--ui-type-size-caption);
}

.ui-mixer-state-button.size-wide {
  width: 2.125rem;
  height: 1.1875rem;
  font-size: var(--ui-type-size-control);
}

.ui-mixer-state-button.tone-mute {
  --mixer-state-button-tone: var(--ui-signal-mixer-mute);
}

.ui-mixer-state-button.tone-solo {
  --mixer-state-button-tone: var(--ui-signal-mixer-solo);
}

.ui-mixer-state-button.tone-record {
  --mixer-state-button-tone: var(--ui-signal-record);
}

.ui-mixer-state-button.tone-input {
  --mixer-state-button-tone: var(--ui-signal-mixer-input);
}

.ui-mixer-state-button.tone-bounce {
  --mixer-state-button-tone: var(--ui-signal-mixer-bounce);
}

.ui-mixer-state-button.active,
.ui-mixer-state-button.tone-bounce:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--mixer-state-button-tone) 36%, transparent);
  color: var(--mixer-state-button-tone);
  background: color-mix(in srgb, var(--mixer-state-button-tone) 20%, transparent);
}

/* An armed record button is the one lit state that must read from across the room. */
.ui-mixer-state-button.tone-record.active {
  border-color: var(--mixer-state-button-tone);
  color: var(--ui-domain-signal-ink);
  background: var(--mixer-state-button-tone);
}

.ui-mixer-state-button.joined-start {
  border-radius: var(--ui-radius-sm) 0 0 var(--ui-radius-sm);
}

.ui-mixer-state-button.joined-middle {
  margin-left: -1px;
  border-radius: 0;
}

.ui-mixer-state-button.joined-end {
  margin-left: -1px;
  border-radius: 0 var(--ui-radius-sm) var(--ui-radius-sm) 0;
}

.ui-mixer-state-button:focus-visible {
  position: relative;
  z-index: var(--ui-z-local-controls);
  outline: 2px solid var(--ui-color-focus);
  outline-offset: 1px;
}

.ui-mixer-state-button:disabled {
  border-color: color-mix(in srgb, var(--mixer-state-button-tone) 24%, transparent);
  color: var(--mixer-state-button-tone);
  background: color-mix(in srgb, var(--mixer-state-button-tone) 10%, transparent);
  cursor: not-allowed;
  opacity: 0.78;
}
</style>
