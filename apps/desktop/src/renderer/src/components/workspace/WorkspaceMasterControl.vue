<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import type {
  MeterPeakHold,
  MeterReturnRate,
  MixerChannelMeter,
  MixerChannelPatch,
  MixerChannelCoreState,
  MixerParameterPreview
} from "@heron/contracts"
import { FADER_MIN_DB } from "../../utils/mixerDbScale"
import MixerQuickGainControl from "../mixer/MixerQuickGainControl.vue"

const props = defineProps<{
  channel: MixerChannelCoreState | null
  meter?: MixerChannelMeter
  meterPeakHold?: MeterPeakHold
  meterReturnRate?: MeterReturnRate
  disabled?: boolean
}>()
const emit = defineEmits<{
  preview: [preview: MixerParameterPreview]
  updateChannel: [channelId: string, patch: MixerChannelPatch]
}>()
const { t } = useI18n()
const meter = computed<MixerChannelMeter>(
  () =>
    props.meter ?? {
      channelId: props.channel?.id ?? "",
      preFaderPeak: [0, 0],
      postFaderPeak: [0, 0],
      heldPeak: [0, 0],
      clipped: false
    }
)
function previewGain(value: number): void {
  if (!props.channel || props.disabled) return
  emit("preview", { target: "channel", id: props.channel.id, parameter: "gainDb", value })
}
function commitGain(value: number): void {
  if (!props.channel || props.disabled) return
  emit("updateChannel", props.channel.id, { gainDb: value })
}
</script>

<template>
  <section class="master-control" :aria-label="t('studio.master.ariaLabel')">
    <MixerQuickGainControl
      :channel-name="t('studio.master.channelName')"
      :value="channel?.gainDb ?? FADER_MIN_DB"
      :meter="meter"
      :meter-peak-hold="meterPeakHold"
      :meter-return-rate="meterReturnRate"
      :disabled="disabled || !channel"
      @preview="previewGain"
      @commit="commitGain"
    />
  </section>
</template>

<style scoped>
.master-control {
  flex: none;
  width: clamp(112px, 10vw, 148px);
  min-width: 0;
  -webkit-app-region: no-drag;
}
@media (max-width: 1279px) {
  .master-control {
    width: 112px;
  }
}
</style>
