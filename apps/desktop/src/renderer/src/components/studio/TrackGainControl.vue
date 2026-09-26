<script setup lang="ts">
import type { MixerChannelMeter } from "@heron/contracts"
import MixerQuickGainControl from "../mixer/MixerQuickGainControl.vue"
import { useStudioChannelMeter } from "../../composables/useStudioChannelMeter"
const props = defineProps<{
  channelName: string
  channelId?: string
  value: number
  meter?: MixerChannelMeter
  disabled?: boolean
}>()
const emit = defineEmits<{ preview: [value: number]; commit: [value: number] }>()
const { meter, meterPeakHold, meterReturnRate } = useStudioChannelMeter(
  () => props.channelId,
  () => props.meter
)
</script>

<template>
  <MixerQuickGainControl
    class="track-gain"
    :value="props.value"
    :channel-name="channelName"
    :meter="meter"
    :meter-peak-hold="meterPeakHold"
    :meter-return-rate="meterReturnRate"
    :disabled="props.disabled"
    @preview="emit('preview', $event)"
    @commit="emit('commit', $event)"
  />
</template>
