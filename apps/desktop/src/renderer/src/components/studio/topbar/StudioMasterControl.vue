<script setup lang="ts">
import type {
  MixerChannelMeter,
  MixerChannelPatch,
  MixerChannelCoreState,
  MixerParameterPreview
} from "@heron/contracts"
import { useStudioChannelMeter } from "../../../composables/useStudioChannelMeter"
import WorkspaceMasterControl from "../../workspace/WorkspaceMasterControl.vue"

const props = defineProps<{
  channel: MixerChannelCoreState | null
  meter?: MixerChannelMeter
  disabled?: boolean
}>()
const emit = defineEmits<{
  preview: [preview: MixerParameterPreview]
  updateChannel: [channelId: string, patch: MixerChannelPatch]
}>()

const { meter, meterPeakHold, meterReturnRate } = useStudioChannelMeter(
  () => props.channel?.id,
  () => props.meter
)
</script>

<template>
  <WorkspaceMasterControl
    :channel="channel"
    :meter="meter"
    :meter-peak-hold="meterPeakHold"
    :meter-return-rate="meterReturnRate"
    :disabled="disabled"
    @preview="emit('preview', $event)"
    @update-channel="(id, patch) => emit('updateChannel', id, patch)"
  />
</template>
