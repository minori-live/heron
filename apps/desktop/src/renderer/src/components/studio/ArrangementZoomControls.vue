<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiZoomControl } from "@heron/ui"
const props = defineProps<{
  pixelsPerQuarter: number
  trackHeight: number
  amplitudeScale: number
}>()
const emit = defineEmits<{
  setTime: [value: number]
  setTrack: [value: number]
  setAmplitude: [value: number]
  resetTime: []
  resetTrack: []
  resetAmplitude: []
}>()
const { t } = useI18n()
const position = (value: number, min: number, max: number, logarithmic = false) =>
  logarithmic
    ? (Math.log(value / min) / Math.log(max / min)) * 100
    : ((value - min) / (max - min)) * 100
const value = (point: number, min: number, max: number, logarithmic = false) =>
  logarithmic ? min * (max / min) ** (point / 100) : min + (point / 100) * (max - min)
const time = computed(() => position(props.pixelsPerQuarter, 12.5, 800, true))
const track = computed(() => position(props.trackHeight, 72, 320))
const amplitude = computed(() => position(props.amplitudeScale, 0.5, 8, true))
</script>

<template>
  <div class="zoom-controls" :aria-label="t('studio.zoom.ariaLabel')">
    <UiZoomControl
      :model-value="time"
      :label="t('studio.zoom.timeZoom')"
      :reset-label="t('studio.zoom.timeZoomReset')"
      :value-text="t('studio.zoom.timeZoomValue', { pixels: Math.round(pixelsPerQuarter) })"
      visual="timeline"
      @update:model-value="emit('setTime', value($event, 12.5, 800, true))"
      @reset="emit('resetTime')"
    />
    <UiZoomControl
      :model-value="track"
      :label="t('studio.zoom.trackHeight')"
      :reset-label="t('studio.zoom.trackHeightReset')"
      :value-text="t('studio.zoom.trackHeightValue', { height: trackHeight })"
      visual="track-height"
      @update:model-value="emit('setTrack', Math.round(value($event, 72, 320)))"
      @reset="emit('resetTrack')"
    />
    <UiZoomControl
      :model-value="amplitude"
      :label="t('studio.zoom.waveformGain')"
      :reset-label="t('studio.zoom.waveformGainReset')"
      :value-text="t('studio.zoom.waveformGainValue', { scale: amplitudeScale.toFixed(1) })"
      visual="waveform"
      @update:model-value="emit('setAmplitude', value($event, 0.5, 8, true))"
      @reset="emit('resetAmplitude')"
    />
  </div>
</template>

<style scoped>
.zoom-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--ui-space-3);
}
</style>
