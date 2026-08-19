<script setup lang="ts">
import type {
  MixerChannelMeter,
  MixerChannelPatch,
  MixerChannelState,
  MixerParameterPreview
} from "@heron/contracts"
import TrackGainControl from "./TrackGainControl.vue"
import TrackPanControl from "./TrackPanControl.vue"
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiMixerStateButton } from "@heron/ui"

const { t } = useI18n()

const props = defineProps<{
  channel: MixerChannelState
  meter?: MixerChannelMeter
}>()

const emit = defineEmits<{
  preview: [preview: MixerParameterPreview]
  updateChannel: [channelId: string, patch: MixerChannelPatch]
}>()

const supportsRecording = computed(
  () =>
    props.channel.kind === "audio" ||
    (props.channel.kind === "instrument" && props.channel.systemRole === null)
)
const supportsMonitoring = computed(
  () =>
    props.channel.kind === "audio" ||
    props.channel.kind === "aux" ||
    (props.channel.kind === "instrument" && props.channel.systemRole === null)
)
const monitoringAvailable = computed(
  () =>
    (props.channel.kind === "instrument" && props.channel.systemRole === null) ||
    ((props.channel.kind === "audio" || props.channel.kind === "aux") &&
      (props.channel.inputSource === "hardware" ||
        (props.channel.inputSource === "application" && props.channel.applicationCapture != null)))
)
const monitoringActive = computed(() => monitoringAvailable.value && props.channel.inputMonitoring)

function preview(parameter: "gainDb" | "pan", value: number): void {
  emit("preview", {
    target: "channel",
    id: props.channel.id,
    parameter,
    value
  })
}
</script>

<template>
  <div
    class="track-quick-controls"
    :aria-label="t('studio.trackControls.ariaLabel', { name: channel.name })"
  >
    <UiMixerStateButton
      tone="mute"
      size="narrow"
      stop-propagation
      :pressed="channel.muted"
      :label="t('studio.trackControls.muteAria', { name: channel.name })"
      :title="t('studio.trackControls.mute')"
      @click="emit('updateChannel', channel.id, { muted: !channel.muted })"
    >
      M
    </UiMixerStateButton>
    <UiMixerStateButton
      tone="solo"
      size="narrow"
      stop-propagation
      :pressed="channel.soloed"
      :label="t('studio.trackControls.soloAria', { name: channel.name })"
      :title="t('studio.trackControls.solo')"
      @click="emit('updateChannel', channel.id, { soloed: !channel.soloed })"
    >
      S
    </UiMixerStateButton>
    <UiMixerStateButton
      v-if="supportsRecording"
      tone="record"
      size="narrow"
      stop-propagation
      :pressed="channel.recordArmed"
      :label="t('studio.trackControls.armAria', { name: channel.name })"
      :title="t('studio.trackControls.recordEnable')"
      @click="emit('updateChannel', channel.id, { recordArmed: !channel.recordArmed })"
    >
      R
    </UiMixerStateButton>
    <UiMixerStateButton
      v-if="supportsMonitoring"
      tone="input"
      size="narrow"
      stop-propagation
      :label="t('studio.trackControls.monitorAria', { name: channel.name })"
      :pressed="monitoringActive"
      :title="
        monitoringAvailable
          ? t('studio.trackControls.inputMonitoring')
          : t('studio.trackControls.inputMonitoringDisabled')
      "
      :disabled="!monitoringAvailable"
      @click="emit('updateChannel', channel.id, { inputMonitoring: !channel.inputMonitoring })"
    >
      I
    </UiMixerStateButton>

    <TrackGainControl
      :channel-name="channel.name"
      :channel-id="channel.id"
      :value="channel.gainDb"
      :meter="meter"
      @preview="preview('gainDb', $event)"
      @commit="emit('updateChannel', channel.id, { gainDb: $event })"
    />
    <TrackPanControl
      :channel-name="channel.name"
      :value="channel.pan"
      @preview="preview('pan', $event)"
      @commit="emit('updateChannel', channel.id, { pan: $event })"
    />
  </div>
</template>

<style scoped>
.track-quick-controls {
  display: grid;
  grid-template-columns: repeat(4, 17px) minmax(64px, 1fr) 23px;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 23px;
}
</style>
