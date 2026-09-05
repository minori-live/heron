<script setup lang="ts">
import type { UiGestureIntent, UiTimelineMark, UiTimelineRegion } from "../types"
import UiGestureSurface from "./internal/UiGestureSurface.vue"

const props = withDefaults(
  defineProps<{
    width: number
    label: string
    marks: readonly UiTimelineMark[]
    beatMarks?: readonly UiTimelineMark[]
    cycleLabel: string
    cycleRegion?: UiTimelineRegion | null
    cycleEnabled?: boolean
    cycleDisabled?: boolean
    projectEnd: number
    projectEndLabel: string
    projectEndTitle?: string
  }>(),
  {
    beatMarks: () => [],
    cycleRegion: null,
    cycleEnabled: false,
    cycleDisabled: false,
    projectEndTitle: undefined
  }
)
const emit = defineEmits<{
  seek: [position: number]
  cycleGesture: [mode: "create" | "move" | "resize-start" | "resize-end", intent: UiGestureIntent]
  projectEndGesture: [intent: UiGestureIntent]
  projectEndStep: [direction: -1 | 1]
}>()

function seek(intent: UiGestureIntent): void {
  if (intent.phase === "start") emit("seek", Math.max(0, intent.point.x))
}
</script>

<template>
  <UiGestureSurface
    class="ui-timeline-ruler"
    :style="{ width: `${props.width}px` }"
    :label="props.label"
    @gesture="seek"
  >
    <span
      v-for="mark in props.beatMarks"
      :key="mark.id"
      class="ui-timeline-ruler__beat"
      :style="{ left: `${mark.position}px` }"
    />
    <span
      v-for="mark in props.marks"
      :key="mark.id"
      class="ui-timeline-ruler__mark"
      :style="{ left: `${mark.position}px` }"
      >{{ mark.label }}</span
    >
    <UiGestureSurface
      class="ui-timeline-ruler__cycle-lane"
      coordinate-selector=".ui-timeline-ruler"
      :label="props.cycleLabel"
      :disabled="props.cycleDisabled"
      @gesture="emit('cycleGesture', 'create', $event)"
    >
      <UiGestureSurface
        v-if="props.cycleRegion"
        class="ui-timeline-ruler__cycle"
        :class="{ 'ui-timeline-ruler__cycle--enabled': props.cycleEnabled }"
        :style="{
          left: `${props.cycleRegion.start}px`,
          width: `${Math.max(2, props.cycleRegion.end - props.cycleRegion.start)}px`
        }"
        :label="props.cycleLabel"
        coordinate-selector=".ui-timeline-ruler"
        @gesture="emit('cycleGesture', 'move', $event)"
      >
        <UiGestureSurface
          as="button"
          class="ui-timeline-ruler__edge ui-timeline-ruler__edge--start"
          coordinate-selector=".ui-timeline-ruler"
          :label="props.cycleLabel"
          @gesture="emit('cycleGesture', 'resize-start', $event)"
        />
        <UiGestureSurface
          as="button"
          class="ui-timeline-ruler__edge ui-timeline-ruler__edge--end"
          coordinate-selector=".ui-timeline-ruler"
          :label="props.cycleLabel"
          @gesture="emit('cycleGesture', 'resize-end', $event)"
        />
      </UiGestureSurface>
    </UiGestureSurface>
    <span
      class="ui-timeline-ruler__shade"
      :style="{
        left: `${props.projectEnd}px`,
        width: `${Math.max(0, props.width - props.projectEnd)}px`
      }"
    />
    <UiGestureSurface
      as="button"
      class="ui-timeline-ruler__end"
      :style="{ left: `${props.projectEnd}px` }"
      :label="props.projectEndLabel"
      coordinate-selector=".ui-timeline-ruler"
      :title="props.projectEndTitle"
      @gesture="emit('projectEndGesture', $event)"
      @step="emit('projectEndStep', $event)"
    />
  </UiGestureSurface>
</template>

<style scoped>
.ui-timeline-ruler {
  position: relative;
  height: 43px;
  overflow: hidden;
  border-bottom: 1px solid var(--ui-color-border-strong);
  background: var(--ui-color-surface-sunken);
  user-select: none;
}
.ui-timeline-ruler::after {
  position: absolute;
  top: 16px;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--ui-color-border);
  content: "";
}
.ui-timeline-ruler__cycle-lane {
  position: absolute;
  z-index: var(--ui-z-local-raised);
  top: 0;
  right: 0;
  left: 0;
  height: 16px;
  cursor: crosshair;
  touch-action: none;
}
.ui-timeline-ruler__cycle {
  position: absolute;
  top: 2px;
  bottom: 2px;
  min-width: 2px;
  border: 1px solid var(--ui-color-action);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-color-action);
  cursor: grab;
  opacity: 0.44;
}
.ui-timeline-ruler__cycle--enabled {
  box-shadow: var(--ui-shadow-glow);
  opacity: 1;
}
.ui-timeline-ruler__edge {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 7px;
  cursor: ew-resize;
}
.ui-timeline-ruler__edge--start {
  left: -3px;
}
.ui-timeline-ruler__edge--end {
  right: -3px;
}
.ui-timeline-ruler__mark {
  position: absolute;
  top: 16px;
  bottom: 0;
  min-width: 28px;
  padding: 8px 0 0 7px;
  border-left: 1px solid var(--ui-color-border);
  color: var(--ui-color-text-muted);
  font: var(--ui-type-size-control) var(--ui-type-family-data);
  pointer-events: none;
}
.ui-timeline-ruler__beat {
  position: absolute;
  top: 16px;
  bottom: 0;
  width: 1px;
  background: var(--ui-color-border);
  opacity: 0.32;
  pointer-events: none;
}
.ui-timeline-ruler__shade {
  position: absolute;
  z-index: var(--ui-z-local-raised);
  top: 16px;
  bottom: 0;
  background: var(--ui-color-overlay);
  pointer-events: none;
}
.ui-timeline-ruler__end {
  position: absolute;
  z-index: var(--ui-z-local-selection);
  top: 0;
  width: 13px;
  height: 18px;
  padding: 0;
  border: 0;
  color: var(--ui-color-text-muted);
  background: currentColor;
  clip-path: polygon(0 0, 100% 0, 100% 54%, 50% 100%, 0 54%);
  cursor: ew-resize;
  transform: translateX(-6px);
  touch-action: none;
}
.ui-timeline-ruler__end:hover,
.ui-timeline-ruler__end:focus-visible {
  color: var(--ui-color-text);
  outline: 2px solid var(--ui-color-focus);
  outline-offset: 2px;
}
</style>
