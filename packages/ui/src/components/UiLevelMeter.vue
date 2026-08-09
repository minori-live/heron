<script setup lang="ts">
import { computed } from "vue"

import type { UiScaleMark, UiScaleSide } from "../types"
import UiDbScale from "./UiDbScale.vue"

interface MeterChannel {
  levelPercent: number
  heldLevelPercent: number
  hasHeldPeak: boolean
}

const props = withDefaults(
  defineProps<{
    channels: readonly MeterChannel[]
    clipped: boolean
    marks?: readonly UiScaleMark[]
    scaleSide?: UiScaleSide
    label?: string
  }>(),
  {
    marks: () => [],
    scaleSide: "left",
    label: undefined
  }
)

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

const displayedChannels = computed(() =>
  props.channels.map((channel) => ({
    hasHeldPeak: channel.hasHeldPeak,
    levelPercent: clampPercent(channel.levelPercent),
    style: {
      "--level-meter-level": `${clampPercent(channel.levelPercent)}%`,
      "--level-meter-held-level": `${clampPercent(channel.heldLevelPercent)}%`
    }
  }))
)
const maximumLevel = computed(() =>
  Math.max(0, ...displayedChannels.value.map((channel) => channel.levelPercent))
)
const channelValueText = computed(() =>
  displayedChannels.value
    .map(
      (channel, index) =>
        `${index === 0 ? "L" : index === 1 ? "R" : index + 1} ${Math.round(channel.levelPercent)}%`
    )
    .join(", ")
)
</script>

<template>
  <div :class="['ui-level-meter', `scale-${scaleSide}`]">
    <UiDbScale v-if="marks.length > 0" class="ui-level-meter__scale" :marks :side="scaleSide" />
    <div
      class="ui-level-meter__well"
      :class="{ clipped }"
      role="meter"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(maximumLevel)"
      :aria-valuetext="channelValueText"
      :aria-label="label"
    >
      <span v-for="(channel, index) in displayedChannels" :key="index" :style="channel.style">
        <i v-if="channel.hasHeldPeak" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.ui-level-meter {
  display: grid;
  grid-template-columns: 0.9375rem 1rem;
  align-self: stretch;
  justify-self: center;
  gap: 1px;
  min-height: 0;
}

.ui-level-meter.scale-right {
  grid-template-columns: 1rem 0.9375rem;
}

.ui-level-meter.scale-right .ui-level-meter__scale {
  grid-column: 2;
  grid-row: 1;
}

.ui-level-meter__well {
  position: relative;
  display: flex;
  align-self: stretch;
  width: 1rem;
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-color-control-pressed);
}

.ui-level-meter__well span {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.ui-level-meter__well span::before {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    var(--ui-signal-meter-safe) 0 68%,
    var(--ui-signal-meter-warning) 79%,
    var(--ui-signal-meter-clip) 100%
  );
  content: "";
  opacity: 0.26;
}

.ui-level-meter__well span::after {
  position: absolute;
  inset: 0 0 var(--level-meter-level) 0;
  background: var(--ui-color-control-pressed);
  content: "";
}

.ui-level-meter__well span i {
  position: absolute;
  z-index: var(--ui-z-local-raised);
  right: 0;
  bottom: var(--level-meter-held-level);
  left: 0;
  height: 1px;
  background: var(--ui-signal-meter-warning);
  box-shadow: 0 0 2px color-mix(in srgb, var(--ui-signal-meter-warning) 65%, transparent);
  opacity: 0.9;
}

.ui-level-meter__well.clipped {
  border-color: var(--ui-signal-meter-clip);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-signal-meter-clip) 35%, transparent);
}
</style>
