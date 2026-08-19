<script setup lang="ts" generic="T extends string">
const props = defineProps<{
  label: string
  minimizeLabel: string
  maximizeLabel: string
  closeLabel: string
  minimizeCommand: T
  maximizeCommand: T
  closeCommand: T
}>()
const emit = defineEmits<{
  command: [command: T]
}>()
</script>

<template>
  <div class="ui-window-controls" role="group" :aria-label="props.label">
    <button
      class="ui-window-control"
      type="button"
      :title="props.minimizeLabel"
      :aria-label="props.minimizeLabel"
      @click="emit('command', props.minimizeCommand)"
    >
      <slot name="minimize" />
    </button>
    <button
      class="ui-window-control"
      type="button"
      :title="props.maximizeLabel"
      :aria-label="props.maximizeLabel"
      @click="emit('command', props.maximizeCommand)"
    >
      <slot name="maximize" />
    </button>
    <button
      class="ui-window-control ui-window-control--close"
      type="button"
      :title="props.closeLabel"
      :aria-label="props.closeLabel"
      @click="emit('command', props.closeCommand)"
    >
      <slot name="close" />
    </button>
  </div>
</template>

<style scoped>
.ui-window-controls {
  display: flex;
  align-items: center;
  flex: none;
  gap: var(--ui-space-1);
  app-region: no-drag;
  -webkit-app-region: no-drag;
}

.ui-window-control {
  display: grid;
  width: var(--ui-control-sm);
  height: 27px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  color: var(--ui-color-text-muted);
  background: transparent;
  cursor: default;
}

.ui-window-control:hover {
  border-color: var(--ui-color-border-strong);
  color: var(--ui-color-text);
  background: var(--ui-color-surface-hover);
}

.ui-window-control:active {
  color: var(--ui-color-action-hover);
  background: var(--ui-color-control-pressed);
}

.ui-window-control--close:hover,
.ui-window-control--close:active {
  border-color: var(--ui-color-danger);
  color: var(--ui-color-danger-text);
  background: var(--ui-color-danger);
}
</style>
