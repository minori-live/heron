<script setup lang="ts">
import type { MixerStripChannel } from "./mixer-surface-context"
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton } from "@heron/ui"
import type {
  MixerChannelPatch,
  PluginDescriptor,
  PluginInstanceState,
  PluginRuntimeStatus
} from "@heron/contracts"
import type { PluginSelection } from "../plugins/plugin-audio-mode"
import MixerInputCapsule from "./MixerInputCapsule.vue"
import MixerInstrumentInput from "./MixerInstrumentInput.vue"

const props = withDefaults(
  defineProps<{
    channel: MixerStripChannel
    instrument: PluginInstanceState | null
    pluginRuntime: Record<string, PluginRuntimeStatus>
    instrumentPlugins: PluginDescriptor[]
    applicationCaptureEnabled?: boolean
    pluginEditorsEnabled?: boolean
    hardwareInputCount?: number
    structureEnabled?: boolean
  }>(),
  {
    applicationCaptureEnabled: true,
    pluginEditorsEnabled: true,
    hardwareInputCount: 32,
    structureEnabled: true
  }
)

const emit = defineEmits<{
  updateChannel: [patch: MixerChannelPatch]
  openPlugin: [instanceId: string]
  retryPlugin: [instanceId: string]
  removePlugin: [instanceId: string]
  assignInstrument: [selection: PluginSelection]
}>()

const { t } = useI18n()

const inputSummary = computed(() => {
  if (props.channel.kind === "master") return t("mixer.inputSection.global")
  return t("mixer.inputSection.mixBus")
})
</script>

<template>
  <section class="strip-section input-section" data-section="input">
    <MixerInstrumentInput
      v-if="channel.kind === 'instrument'"
      :instrument="instrument"
      :runtime="pluginRuntime"
      :plugins="instrumentPlugins"
      :editors-enabled="pluginEditorsEnabled"
      :structure-enabled="structureEnabled"
      @open="emit('openPlugin', $event)"
      @retry="emit('retryPlugin', $event)"
      @remove="emit('removePlugin', $event)"
      @assign="emit('assignInstrument', $event)"
    />
    <MixerInputCapsule
      v-else-if="channel.kind === 'audio' || channel.kind === 'aux'"
      :inert="!structureEnabled || undefined"
      :channel-name="channel.name"
      :input-source="channel.inputSource ?? 'hardware'"
      :input-format="channel.inputFormat ?? 'stereo'"
      :input-channels="channel.inputChannels"
      :application-capture="channel.applicationCapture"
      :application-capture-enabled="applicationCaptureEnabled"
      :hardware-input-count="hardwareInputCount"
      @update="emit('updateChannel', $event)"
    />
    <UiButton v-else class="section-control" size="sm" disabled>
      {{ inputSummary }}
    </UiButton>
  </section>
</template>

<style scoped>
.strip-section {
  display: grid;
  align-items: center;
  min-width: 0;
  padding: 7px;
  border-bottom: 1px solid var(--ui-domain-mixer-divider);
  background: var(--ui-domain-mixer-section);
}
.section-control {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  min-width: 0;
  padding: 0 7px;
  overflow: hidden;
  border: 1px solid var(--ui-domain-face-neutral-border);
  border-radius: 4px;
  color: var(--ui-domain-face-neutral-ink);
  background: linear-gradient(
    var(--ui-domain-face-neutral-top),
    var(--ui-domain-face-neutral-bottom)
  );
  font: var(--ui-type-size-control) var(--ui-type-family-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
