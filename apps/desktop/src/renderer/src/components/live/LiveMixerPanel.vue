<script setup lang="ts">
import { computed, shallowRef } from "vue"
import { useWindowSize } from "@vueuse/core"
import { useI18n } from "vue-i18n"
import { UiResizeHandle, type UiGestureIntent } from "@heron/ui"

const { t } = useI18n()
const { width: windowWidth } = useWindowSize()
const DEFAULT_WIDTH = 520
const MINIMUM_WIDTH = 360
const requestedWidth = defineModel<number>({ default: DEFAULT_WIDTH })
const maximumWidth = computed(() => Math.max(MINIMUM_WIDTH, windowWidth.value - 414))
const width = computed(() => Math.min(requestedWidth.value, maximumWidth.value))
const startWidth = shallowRef(width.value)
const resizing = shallowRef(false)
function setWidth(value: number): void {
  requestedWidth.value = Math.max(MINIMUM_WIDTH, Math.min(maximumWidth.value, value))
}
function resize(intent: UiGestureIntent): void {
  if (intent.phase === "start") {
    startWidth.value = width.value
    resizing.value = true
  } else if (intent.phase === "update") {
    setWidth(startWidth.value - intent.delta.x)
  } else if (intent.phase === "commit") {
    setWidth((resizing.value ? startWidth.value : width.value) - intent.delta.x)
    resizing.value = false
  } else {
    setWidth(startWidth.value)
    resizing.value = false
  }
}
</script>

<template>
  <aside class="live-mixer-panel" :style="{ width: `${width}px` }" :aria-label="t('live.mixer')">
    <UiResizeHandle
      class="live-mixer-resizer"
      axis="horizontal"
      :label="t('live.resizeMixer')"
      :keyboard-step="10"
      :value="width"
      :minimum="MINIMUM_WIDTH"
      :maximum="maximumWidth"
      reset-on-double-click
      @gesture="resize"
      @reset="setWidth(DEFAULT_WIDTH)"
    />
    <slot />
  </aside>
</template>

<style scoped>
.live-mixer-panel {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--line-strong);
}
.live-mixer-resizer {
  position: absolute;
  z-index: var(--ui-z-local-controls);
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
}
</style>
