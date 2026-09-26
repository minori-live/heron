<script setup lang="ts">
import { computed, provide, toRaw } from "vue"
import { useI18n } from "vue-i18n"
import { Plus, RotateCcw, RotateCw } from "@lucide/vue"
import { UiButton, UiIconButton } from "@heron/ui"
import type {
  MixerGraphSnapshot,
  MixerChannelPatch,
  MixerSendPatch,
  MixerParameterPreview,
  MixerRouteTarget,
  PluginDescriptor,
  PluginRuntimeStatus
} from "@heron/contracts"
import {
  MIXER_BUSES,
  availableOutputTargets,
  availableSendTargets,
  sendsFor
} from "@heron/project-model"
import type { PluginSelection } from "../plugins/plugin-audio-mode"
import type { MixerStripDisplayOptions } from "./mixer-strip-display-options"
import {
  mixerMeterSourceKey,
  type MixerMeterSource,
  type MixerStripChannel
} from "./mixer-surface-context"
import MixerChannelStrip from "./MixerChannelStrip.vue"
import MixerSectionLabels from "./MixerSectionLabels.vue"

const props = withDefaults(
  defineProps<{
    graph: MixerGraphSnapshot
    selectedChannelId?: string | null
    canUndo?: boolean
    canRedo?: boolean
    busy?: boolean
    pluginRuntime?: Record<string, PluginRuntimeStatus>
    effectPlugins?: PluginDescriptor[]
    instrumentPlugins?: PluginDescriptor[]
    studioControls?: boolean
    applicationCaptureEnabled?: boolean
    pluginEditorsEnabled?: boolean
    hardwareInputCount?: number
    hardwareOutputCount?: number
    meterSource?: MixerMeterSource
    displayOptions?: MixerStripDisplayOptions
    lowLatencyTargetOutputChannelId?: string | null
    lowLatencyTargetDisabled?: boolean
    error?: string
  }>(),
  {
    selectedChannelId: null,
    pluginRuntime: () => ({}),
    effectPlugins: () => [],
    instrumentPlugins: () => [],
    studioControls: true,
    applicationCaptureEnabled: true,
    pluginEditorsEnabled: true,
    hardwareInputCount: 32,
    hardwareOutputCount: 32,
    meterSource: undefined,
    displayOptions: undefined,
    lowLatencyTargetOutputChannelId: null,
    error: ""
  }
)
const emit = defineEmits<{
  createChannel: [kind: "audio" | "instrument" | "aux" | "output"]
  undo: []
  redo: []
  select: [channelId: string]
  preview: [preview: MixerParameterPreview]
  updateChannel: [channelId: string, patch: MixerChannelPatch]
  updateSend: [sendId: string, patch: MixerSendPatch]
  addSend: [sourceChannelId: string, target: MixerRouteTarget]
  deleteSend: [sendId: string]
  openPlugin: [instanceId: string]
  retryPlugin: [instanceId: string]
  togglePlugin: [instanceId: string, enabled: boolean]
  removePlugin: [instanceId: string]
  insertPlugin: [channelId: string, selection: PluginSelection, slotOrder: number]
  movePlugin: [instanceId: string, channelId: string, slotOrder: number]
  assignInstrument: [channelId: string, selection: PluginSelection]
  deleteChannel: [channelId: string]
  resetMeterClips: []
  selectLowLatencyOutput: [channelId: string]
  bounceOutput: [channel: MixerStripChannel]
}>()

const { t } = useI18n()
// Resolve telemetry in the leaf, so publishing a meter frame never rebuilds the console.
if (props.meterSource) provide(mixerMeterSourceKey, (id) => props.meterSource?.(id))
const channels = computed<MixerStripChannel[]>(() => props.graph.channels)
const orderedChannels = computed(() => [
  ...channels.value.filter((channel) => channel.kind === "audio" && channel.systemRole == null),
  ...channels.value.filter(
    (channel) => channel.kind === "instrument" && channel.systemRole == null
  ),
  ...channels.value.filter((channel) => channel.systemRole != null),
  ...channels.value.filter((channel) => channel.kind === "aux"),
  ...channels.value.filter((channel) => channel.kind === "master"),
  ...channels.value.filter((channel) => channel.kind === "output")
])
const outputs = computed(() => channels.value.filter((channel) => channel.kind === "output"))
const routes = computed(
  () =>
    new Map(
      channels.value.map((channel) => [
        channel.id,
        {
          output: availableOutputTargets(toRaw(props.graph), channel.id),
          send: availableSendTargets(toRaw(props.graph), channel.id)
        }
      ])
    )
)
function outputTargetsFor(channelId: string) {
  return routes.value.get(channelId)?.output ?? []
}
function sendTargetsFor(channelId: string) {
  return routes.value.get(channelId)?.send ?? []
}
function sendsForChannel(channelId: string) {
  return sendsFor(props.graph, channelId)
}
function pluginsFor(channelId: string) {
  return props.graph.plugins
    .filter((plugin) => plugin.channelId === channelId)
    .sort((left, right) => {
      if (left.role !== right.role) return left.role === "instrument" ? -1 : 1
      return left.slotOrder - right.slotOrder
    })
}
const pluginSlotRows = computed(
  () =>
    Math.max(
      0,
      ...orderedChannels.value.map((channel) =>
        channel.kind === "master"
          ? 0
          : props.graph.plugins.filter(
              (plugin) => plugin.channelId === channel.id && plugin.role === "insert"
            ).length
      )
    ) + 1
)
const sendSlotRows = computed(() =>
  Math.max(
    1,
    ...orderedChannels.value.map((channel) =>
      ["audio", "instrument", "aux"].includes(channel.kind)
        ? sendsForChannel(channel.id).length + (sendTargetsFor(channel.id).length > 0 ? 1 : 0)
        : 0
    )
  )
)
const sectionStyle = computed(() => ({
  "--plugin-section-height": `${12 + pluginSlotRows.value * 24}px`,
  "--send-section-height": `${12 + sendSlotRows.value * 26}px`
}))
</script>
<template>
  <section
    class="mixer-console relative grid min-h-0 min-w-0 grid-rows-[minmax(43px,auto)_minmax(0,1fr)] overflow-hidden bg-[var(--daw-workspace)]"
    :aria-label="t('mixer.console.ariaLabel')"
    :aria-busy="busy || undefined"
  >
    <header
      class="mixer-toolbar flex flex-wrap items-center justify-between gap-ui-2 border-b border-b-solid bg-[var(--surface-1)] py-ui-1 pe-[11px] ps-[14px] [border-bottom-color:var(--line-strong)]"
    >
      <span>{{ t("mixer.console.title") }}</span>
      <nav :aria-label="t('mixer.console.actions.ariaLabel')">
        <UiButton
          size="sm"
          :aria-label="
            t(
              studioControls
                ? 'mixer.console.actions.addAudio'
                : 'mixer.console.actions.addAudioChannel'
            )
          "
          :disabled="busy"
          @click="emit('createChannel', 'audio')"
        >
          <Plus :size="12" />{{ t("mixer.console.actions.addAudioLabel") }}
        </UiButton>
        <UiButton
          size="sm"
          :aria-label="
            t(
              studioControls
                ? 'mixer.console.actions.addInstrument'
                : 'mixer.console.actions.addInstrumentChannel'
            )
          "
          :disabled="busy"
          @click="emit('createChannel', 'instrument')"
        >
          <Plus :size="12" />{{ t("mixer.console.actions.addInstrumentLabel") }}
        </UiButton>
        <UiButton
          size="sm"
          :aria-label="t('mixer.console.actions.addAux')"
          :disabled="busy"
          @click="emit('createChannel', 'aux')"
        >
          <Plus :size="12" />{{ t("mixer.console.actions.addAuxLabel") }}
        </UiButton>
        <UiButton
          size="sm"
          :aria-label="t('mixer.console.actions.addOutput')"
          :disabled="busy"
          @click="emit('createChannel', 'output')"
        >
          <Plus :size="12" />{{ t("mixer.console.actions.addOutputLabel") }}
        </UiButton>
        <UiIconButton
          :label="t('mixer.console.actions.undo')"
          :disabled="!canUndo || busy"
          @click="emit('undo')"
        >
          <RotateCcw :size="13" />
        </UiIconButton>
        <UiIconButton
          :label="t('mixer.console.actions.redo')"
          :disabled="!canRedo || busy"
          @click="emit('redo')"
        >
          <RotateCw :size="13" />
        </UiIconButton>
      </nav>
    </header>
    <div
      class="channel-scroll flex min-h-0 min-w-0 items-start overflow-auto"
      :style="sectionStyle"
    >
      <MixerSectionLabels />
      <MixerChannelStrip
        v-for="channel in orderedChannels"
        :key="channel.id"
        :channel="channel"
        :sends="sendsForChannel(channel.id)"
        :outputs="outputs"
        :buses="MIXER_BUSES"
        :output-targets="outputTargetsFor(channel.id)"
        :send-targets="sendTargetsFor(channel.id)"
        :plugins="pluginsFor(channel.id)"
        :plugin-runtime="pluginRuntime ?? {}"
        :effect-plugins="effectPlugins ?? []"
        :instrument-plugins="instrumentPlugins ?? []"
        :plugin-slot-rows="pluginSlotRows"
        :send-slot-rows="sendSlotRows"
        :selected="channel.id === selectedChannelId"
        :studio-controls="studioControls"
        :application-capture-enabled="applicationCaptureEnabled"
        :plugin-editors-enabled="pluginEditorsEnabled"
        :hardware-input-count="hardwareInputCount"
        :hardware-output-count="hardwareOutputCount"
        :display-options="displayOptions"
        :low-latency-target="channel.id === lowLatencyTargetOutputChannelId"
        :low-latency-target-disabled="lowLatencyTargetDisabled"
        @select="emit('select', $event)"
        @preview="emit('preview', $event)"
        @update-channel="(id, patch) => emit('updateChannel', id, patch)"
        @update-send="(id, patch) => emit('updateSend', id, patch)"
        @add-send="(id, target) => emit('addSend', id, target)"
        @delete-send="emit('deleteSend', $event)"
        @open-plugin="emit('openPlugin', $event)"
        @retry-plugin="emit('retryPlugin', $event)"
        @toggle-plugin="(id, enabled) => emit('togglePlugin', id, enabled)"
        @remove-plugin="emit('removePlugin', $event)"
        @insert-plugin="(id, selection, order) => emit('insertPlugin', id, selection, order)"
        @move-plugin="(id, channelId, order) => emit('movePlugin', id, channelId, order)"
        @assign-instrument="(id, selection) => emit('assignInstrument', id, selection)"
        @delete-channel="emit('deleteChannel', $event)"
        @reset-meter-clips="emit('resetMeterClips')"
        @select-low-latency-output="emit('selectLowLatencyOutput', $event)"
        @bounce-output="emit('bounceOutput', $event)"
      />
    </div>
    <p v-if="error" class="mixer-error" role="alert">{{ error }}</p>
    <slot />
  </section>
</template>

<style scoped>
.mixer-toolbar > span {
  color: var(--accent);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-widest);
}
.mixer-toolbar nav {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.channel-scroll {
  background-color: var(--ui-domain-color-4f4f4f);
  background-image: linear-gradient(
    90deg,
    color-mix(in srgb, var(--text-primary) 3%, transparent) 1px,
    transparent 1px
  );
  background-size: 112px 100%;
}
.mixer-error {
  position: absolute;
  right: 10px;
  bottom: 8px;
  margin: 0;
  padding: 6px 9px;
  border: 1px solid color-mix(in srgb, var(--record) 55%, var(--line-strong));
  border-radius: 4px;
  color: var(--record);
  background: color-mix(in srgb, var(--record) 14%, var(--surface-1));
  font-size: var(--ui-type-size-control);
}
</style>
