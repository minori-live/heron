<script setup lang="ts">
import { useMixerConfirmations } from "../../composables/useMixerConfirmations"
import { useMixerStore } from "../../stores/mixer"
import { usePluginStore } from "../../stores/plugins"
import { useLowLatencyModeStore } from "../../stores/lowLatencyMode"
import { useBounceStore } from "../../stores/bounce"
import type { PluginSelection } from "../plugins/plugin-audio-mode"
import MixerSurface from "./MixerSurface.vue"
import BounceOutputDialog from "../bounce/BounceOutputDialog.vue"

const mixerStore = useMixerStore()
const pluginStore = usePluginStore()
const lowLatencyModeStore = useLowLatencyModeStore()
const bounceStore = useBounceStore()
const { confirmChannelDeletion, confirmInstrumentReplacement } = useMixerConfirmations()

function togglePlugin(instanceId: string, enabled: boolean): void {
  void mixerStore.setPluginEnabled(instanceId, enabled)
}

function removePlugin(instanceId: string): void {
  void mixerStore.execute({ type: "delete-plugin", pluginId: instanceId })
}

function insertPlugin(channelId: string, selection: PluginSelection, slotOrder: number): void {
  void pluginStore.addEffectAt(selection, channelId, slotOrder)
}

function movePlugin(instanceId: string, channelId: string, slotOrder: number): void {
  void pluginStore.moveInsert(instanceId, channelId, slotOrder)
}

async function assignInstrument(channelId: string, selection: PluginSelection): Promise<void> {
  const current = mixerStore.graph.plugins.find(
    (plugin) => plugin.channelId === channelId && plugin.role === "instrument"
  )
  if (current) {
    const confirmed = await confirmInstrumentReplacement(
      current.descriptor.name,
      selection.descriptor.name
    )
    if (!confirmed) return
  }
  await pluginStore.assignInstrument(selection, channelId)
}

async function deleteChannel(channelId: string): Promise<void> {
  const channel = mixerStore.channels.find((candidate) => candidate.id === channelId)
  if (!channel || channel.kind === "master" || channel.systemRole !== null) return
  const confirmed = await confirmChannelDeletion(channel.name)
  if (confirmed) void mixerStore.deleteChannel(channel.id)
}
function createChannel(kind: "audio" | "instrument" | "aux" | "output"): void {
  if (kind === "audio") void mixerStore.createAudioTrack()
  else if (kind === "instrument") void mixerStore.createInstrumentTrack()
  else if (kind === "aux") void mixerStore.createAux()
  else void mixerStore.createOutput()
}

function bounceOutput(channel: { id: string }): void {
  const studioChannel = mixerStore.channels.find((candidate) => candidate.id === channel.id)
  if (studioChannel) bounceStore.openFor(studioChannel)
}
</script>

<template>
  <MixerSurface
    :graph="mixerStore.graph"
    :selected-channel-id="mixerStore.selectedChannelId"
    :can-undo="mixerStore.canUndo"
    :can-redo="mixerStore.canRedo"
    :plugin-runtime="pluginStore.runtime"
    :effect-plugins="pluginStore.compatibleEffects"
    :instrument-plugins="pluginStore.compatibleInstruments"
    :low-latency-target-output-channel-id="lowLatencyModeStore.targetOutputChannelId"
    :low-latency-target-disabled="!lowLatencyModeStore.canConfigure"
    :error="mixerStore.error"
    @create-channel="createChannel"
    @undo="mixerStore.undo"
    @redo="mixerStore.redo"
    @select="mixerStore.selectedChannelId = $event"
    @preview="mixerStore.preview"
    @update-channel="mixerStore.updateChannel"
    @update-send="mixerStore.updateSend"
    @add-send="mixerStore.addSend"
    @delete-send="mixerStore.deleteSend"
    @open-plugin="pluginStore.openEditor"
    @retry-plugin="pluginStore.retry"
    @toggle-plugin="togglePlugin"
    @remove-plugin="removePlugin"
    @insert-plugin="insertPlugin"
    @move-plugin="movePlugin"
    @assign-instrument="assignInstrument"
    @delete-channel="deleteChannel"
    @reset-meter-clips="mixerStore.clearMeterClips"
    @select-low-latency-output="lowLatencyModeStore.selectOutput"
    @bounce-output="bounceOutput"
  >
    <BounceOutputDialog />
  </MixerSurface>
</template>
