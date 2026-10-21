<script setup lang="ts">
import type {
  MixerChannelMeter,
  MixerChannelPatch,
  MixerChannelState,
  MixerParameterPreview
} from "@heron/contracts"
import TrackGainControl from "./TrackGainControl.vue"
import TrackPanControl from "./TrackPanControl.vue"
import { Snowflake } from "@lucide/vue"
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiMixerStateButton } from "@heron/ui"

export type TrackFreezeButtonState = "off" | "frozen" | "stale"

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    channel: MixerChannelState
    meter?: MixerChannelMeter
    freezeVisible?: boolean
    freezeState?: TrackFreezeButtonState
  }>(),
  {
    meter: undefined,
    freezeVisible: false,
    freezeState: "off"
  }
)

const emit = defineEmits<{
  preview: [preview: MixerParameterPreview]
  updateChannel: [channelId: string, patch: MixerChannelPatch]
  toggleFreeze: []
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
const freezeEngaged = computed(
  () => props.freezeState === "frozen" || props.freezeState === "stale"
)
const freezeLabel = computed(() => {
  if (props.freezeState === "stale") {
    return t("studio.trackControls.staleAria", { name: props.channel.name })
  }
  return freezeEngaged.value
    ? t("studio.trackControls.unfreezeAria", { name: props.channel.name })
    : t("studio.trackControls.freezeAria", { name: props.channel.name })
})

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
    :class="{ 'shows-freeze': freezeVisible }"
    :aria-label="t('studio.trackControls.ariaLabel', { name: channel.name })"
  >
    <div class="track-state-controls" :class="{ 'shows-freeze': freezeVisible }">
      <UiMixerStateButton
        tone="mute"
        size="track"
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
        size="track"
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
        size="track"
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
        size="track"
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
      <UiMixerStateButton
        v-if="freezeVisible"
        class="freeze-button"
        tone="bounce"
        size="track"
        stop-propagation
        :pressed="freezeEngaged"
        :label="freezeLabel"
        :title="t('studio.trackControls.freeze')"
        @click="emit('toggleFreeze')"
      >
        <Snowflake :size="11" />
      </UiMixerStateButton>
    </div>

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
  grid-template-columns: 74px minmax(64px, 1fr) 23px;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 23px;
}
.track-quick-controls.shows-freeze {
  grid-template-columns: 93px minmax(64px, 1fr) 23px;
}
.track-state-controls {
  display: grid;
  grid-template-columns: repeat(4, 17px);
  gap: 2px;
}
.track-state-controls.shows-freeze {
  grid-template-columns: repeat(5, 17px);
}
</style>
