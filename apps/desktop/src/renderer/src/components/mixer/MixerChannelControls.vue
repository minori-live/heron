<script setup lang="ts">
import type { MixerStripChannel } from "./mixer-surface-context"
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import type { MixerChannelPatch } from "@heron/contracts"
import { UiMixerStateButton } from "@heron/ui"

const props = withDefaults(
  defineProps<{
    channel: MixerStripChannel
    monitoringAvailable: boolean
    monitoringActive: boolean
    studioControls?: boolean
    monitoringEditable?: boolean
  }>(),
  { studioControls: true, monitoringEditable: true }
)
const supportsRecording = computed(
  () =>
    props.studioControls !== false &&
    (props.channel.kind === "audio" ||
      (props.channel.kind === "instrument" && props.channel.systemRole == null))
)
const supportsMonitoring = computed(
  () =>
    props.channel.kind === "audio" ||
    props.channel.kind === "aux" ||
    (props.channel.kind === "instrument" && props.channel.systemRole == null)
)

const emit = defineEmits<{
  updateChannel: [patch: MixerChannelPatch]
  bounceOutput: []
}>()

const { t } = useI18n()
</script>

<template>
  <div :class="['channel-actions', { 'has-input': supportsRecording }]">
    <div class="input-actions">
      <UiMixerStateButton
        v-if="channel.kind === 'output' && studioControls !== false"
        size="wide"
        tone="bounce"
        :label="t('mixer.channelControls.bounce', { name: channel.name })"
        :title="t('mixer.channelControls.bounceOutput')"
        stop-propagation
        @click="emit('bounceOutput')"
      >
        Bnc
      </UiMixerStateButton>
      <template v-if="supportsRecording">
        <UiMixerStateButton
          size="narrow"
          tone="record"
          joined="start"
          :pressed="channel.recordArmed ?? false"
          :label="t('mixer.channelControls.arm', { name: channel.name })"
          :title="t('mixer.channelControls.recordEnable')"
          stop-propagation
          @click="emit('updateChannel', { recordArmed: !channel.recordArmed })"
        >
          R
        </UiMixerStateButton>
      </template>
      <template v-if="supportsMonitoring">
        <UiMixerStateButton
          size="narrow"
          tone="input"
          :joined="supportsRecording ? 'end' : undefined"
          :label="t('mixer.channelControls.monitor', { name: channel.name })"
          :pressed="channel.inputMonitoring"
          :active="monitoringActive"
          :title="
            monitoringAvailable
              ? t('mixer.channelControls.inputMonitoring')
              : t('mixer.channelControls.inputMonitoringDisabled')
          "
          :disabled="!monitoringAvailable || !monitoringEditable"
          stop-propagation
          @click="emit('updateChannel', { inputMonitoring: !channel.inputMonitoring })"
        >
          I
        </UiMixerStateButton>
      </template>
    </div>
    <div class="mix-actions">
      <UiMixerStateButton
        tone="mute"
        :pressed="channel.muted"
        :label="t('mixer.channelControls.mute', { name: channel.name })"
        stop-propagation
        @click="emit('updateChannel', { muted: !channel.muted })"
      >
        M
      </UiMixerStateButton>
      <UiMixerStateButton
        v-if="channel.kind !== 'master'"
        tone="solo"
        :pressed="channel.soloed"
        :label="t('mixer.channelControls.solo', { name: channel.name })"
        stop-propagation
        @click="emit('updateChannel', { soloed: !channel.soloed })"
      >
        S
      </UiMixerStateButton>
    </div>
  </div>
</template>

<style scoped>
.channel-actions {
  display: grid;
  grid-template-rows: 20px 24px;
  align-content: center;
  justify-items: center;
  gap: 4px;
  border-top: 1px solid var(--ui-domain-mixer-divider);
  background: var(--ui-domain-mixer-section);
}
.input-actions,
.mix-actions {
  display: flex;
  align-items: center;
  justify-content: center;
}
.input-actions {
  justify-self: end;
  gap: 0;
  min-height: 20px;
  margin-right: 6px;
}
.mix-actions {
  gap: 5px;
}
</style>
