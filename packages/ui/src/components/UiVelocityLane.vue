<script setup lang="ts">
import { useTemplateRef, watch } from "vue"

import type { UiGestureIntent, UiVelocityBar } from "../types"
import UiGestureSurface from "./internal/UiGestureSurface.vue"

const props = defineProps<{
  label: string
  header: string
  width: number
  bars: readonly UiVelocityBar[]
  scrollLeft: number
}>()
const emit = defineEmits<{
  gesture: [intent: UiGestureIntent]
  updateScrollLeft: [value: number]
}>()
const scroller = useTemplateRef<HTMLElement>("scroller")

watch(
  () => props.scrollLeft,
  (value) => {
    if (scroller.value && scroller.value.scrollLeft !== value) scroller.value.scrollLeft = value
  }
)

function syncScroll(): void {
  if (scroller.value) emit("updateScrollLeft", scroller.value.scrollLeft)
}
</script>

<template>
  <div class="ui-velocity-lane">
    <div class="ui-velocity-lane__header">{{ props.header }}</div>
    <div ref="scroller" class="ui-velocity-lane__scroll" @scroll="syncScroll">
      <UiGestureSurface
        class="ui-velocity-lane__canvas"
        :style="{ width: `${props.width}px` }"
        :label="props.label"
        @gesture="emit('gesture', $event)"
      >
        <span
          v-for="bar in props.bars"
          :key="bar.id"
          class="ui-velocity-lane__bar"
          :class="{
            'ui-velocity-lane__bar--selected': bar.selected,
            'ui-velocity-lane__bar--inactive': bar.inactive
          }"
          :style="{
            left: `${bar.x}px`,
            width: `${bar.width ?? 5}px`,
            height: `${bar.height}%`,
            '--ui-velocity-color': bar.color
          }"
          role="img"
          :aria-label="bar.label"
        />
      </UiGestureSurface>
    </div>
  </div>
</template>

<style scoped>
.ui-velocity-lane {
  display: flex;
  min-width: 0;
  height: 110px;
  border-top: 1px solid var(--ui-color-border-strong);
  background: var(--ui-color-surface);
}
.ui-velocity-lane__header {
  flex: none;
  width: 72px;
  padding: var(--ui-space-2) 5px 0 0;
  border-right: 1px solid var(--ui-color-border-strong);
  color: var(--ui-color-text-muted);
  background: var(--ui-color-surface-raised);
  text-align: right;
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}
.ui-velocity-lane__scroll {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.ui-velocity-lane__canvas {
  position: relative;
  height: 100%;
  background: var(--ui-color-surface-sunken);
  cursor: crosshair;
  touch-action: none;
}
.ui-velocity-lane__bar {
  position: absolute;
  bottom: 0;
  border: 1px solid
    color-mix(
      in srgb,
      var(--ui-velocity-color, var(--ui-color-action)) 65%,
      var(--ui-color-border-strong)
    );
  border-bottom: 0;
  border-radius: var(--ui-radius-xs) var(--ui-radius-xs) 0 0;
  background: var(--ui-velocity-color, var(--ui-color-action));
  pointer-events: none;
}
.ui-velocity-lane__bar--inactive {
  opacity: 0.4;
}
.ui-velocity-lane__bar--selected {
  outline: 1px solid var(--ui-color-focus);
  opacity: 1;
}
</style>
