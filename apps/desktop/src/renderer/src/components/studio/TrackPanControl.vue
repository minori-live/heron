<script setup lang="ts">
import { computed } from "vue"
import { UiRotaryControl } from "@heron/ui"
import {
  normalizedToPanUnits,
  panLabelFromNormalized,
  panUnitsToNormalized
} from "../../utils/mixerPan"
const props = defineProps<{ channelName: string; value: number }>()
const emit = defineEmits<{ preview: [value: number]; commit: [value: number] }>()
const panUnits = computed(() => normalizedToPanUnits(props.value))
</script>

<template>
  <UiRotaryControl
    :value="panUnits"
    :min="-64"
    :max="63"
    :step="1"
    :default-value="0"
    :label="`${channelName} quick pan`"
    :value-label="`${channelName} quick pan value`"
    :value-text="(value) => panLabelFromNormalized(panUnitsToNormalized(value))"
    :bipolar-center="0"
    size="compact"
    accent="var(--mixer-pan)"
    @preview="emit('preview', panUnitsToNormalized($event))"
    @commit="emit('commit', panUnitsToNormalized($event))"
  />
</template>
