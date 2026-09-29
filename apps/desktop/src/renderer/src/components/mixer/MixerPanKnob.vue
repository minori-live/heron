<script setup lang="ts">
import { computed } from "vue"
import { UiRotaryControl } from "@heron/ui"

import {
  normalizedToPanUnits,
  panLabelFromNormalized,
  panUnitsToNormalized
} from "../../utils/mixerPan"

const props = defineProps<{
  channelName: string
  value: number
}>()

const emit = defineEmits<{
  preview: [value: number]
  commit: [value: number, settle: () => void]
}>()

const panUnits = computed(() => normalizedToPanUnits(props.value))

function panValueText(value: number): string {
  return panLabelFromNormalized(panUnitsToNormalized(value))
}
</script>

<template>
  <div class="pan-knob">
    <UiRotaryControl
      :value="panUnits"
      :min="-64"
      :max="63"
      :step="1"
      :default-value="0"
      :bipolar-center="0"
      :label="`${channelName} pan`"
      :value-label="`${channelName} pan value`"
      :value-text="panValueText"
      double-click-action="edit"
      await-commit
      accent="var(--ui-signal-mixer-pan)"
      @preview="emit('preview', panUnitsToNormalized($event))"
      @commit="(value, settle) => emit('commit', panUnitsToNormalized(value), settle!)"
    />
  </div>
</template>

<style scoped>
.pan-knob {
  display: grid;
  min-width: 0;
  place-items: center;
}
</style>
