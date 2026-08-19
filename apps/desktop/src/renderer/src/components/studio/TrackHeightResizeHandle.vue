<script setup lang="ts">
import { computed, shallowRef } from "vue"
import { UiResizeHandle, type UiGestureIntent } from "@heron/ui"
const props = defineProps<{ baseHeight: number; scale: number; trackName: string }>()
const emit = defineEmits<{ setScale: [scale: number]; reset: [] }>()
const startScale = shallowRef(props.scale)
const resizeLabel = computed(
  () => `Resize ${props.trackName} track height; current scale ${props.scale.toFixed(2)} times`
)
function resize(intent: UiGestureIntent): void {
  if (intent.phase === "start") startScale.value = props.scale
  if (intent.phase === "update" || intent.phase === "commit")
    emit("setScale", startScale.value + intent.delta.y / props.baseHeight)
}
</script>

<template>
  <UiResizeHandle
    class="track-height-resize-handle"
    axis="vertical"
    :label="resizeLabel"
    :keyboard-step="props.baseHeight * 0.25"
    :value="props.scale"
    :minimum="0.5"
    :maximum="4"
    reset-on-double-click
    @gesture="resize"
    @reset="emit('reset')"
  />
</template>

<style scoped>
.track-height-resize-handle {
  position: absolute;
  z-index: var(--ui-z-local-raised);
  right: 0;
  bottom: -4px;
  left: 0;
}
</style>
