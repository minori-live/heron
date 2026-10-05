<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { RefreshCw } from "@lucide/vue"
import { UiIconButton } from "@heron/ui"
import {
  pluginDescriptorKey,
  type PluginAnalysisCommand,
  type PluginAnalysisSnapshot
} from "@heron/contracts"
import type { MixerStripChannel } from "../mixer/mixer-surface-context"
import type { PluginSelection } from "../plugins/plugin-audio-mode"
import MixerPluginSection from "../mixer/MixerPluginSection.vue"
const props = defineProps<{
  snapshot: PluginAnalysisSnapshot
  catalogBusy: boolean
  chain: 0 | 1
}>()
const emit = defineEmits<{ command: [command: PluginAnalysisCommand] }>()
const { t } = useI18n()
const quarantined = computed(() => props.snapshot.status === "quarantined")
const chainId = computed(() =>
  props.chain === 0 ? props.snapshot.ref.id : `${props.snapshot.ref.id}:comparison`
)
const inserts = computed(() => props.snapshot.plugins.filter((p) => p.channelId === chainId.value))
const channel = computed<MixerStripChannel>(() => ({
  id: chainId.value,
  kind: "audio",
  name: t("pluginAnalysis.title"),
  color: "var(--ui-signal-audio)",
  sortOrder: 0,
  inputSource: null,
  inputFormat: "stereo",
  gainDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
  outputChannelId: null,
  inputMonitoring: false,
  inputChannels: [0, 1],
  hardwareOutputChannels: []
}))
function insert(selection: PluginSelection, slotOrder: number): void {
  emit("command", {
    type: "insert",
    chain: props.chain,
    pluginKey: pluginDescriptorKey(selection.descriptor),
    audioMode: selection.audioMode,
    slotOrder
  })
}
</script>
<template>
  <aside class="plugin-analysis-chain">
    <div class="rack">
      <div class="rack-heading">
        <span>{{ t("pluginAnalysis.inserts") }}</span>
        <UiIconButton
          size="sm"
          variant="plain"
          :label="t('pluginAnalysis.rescan')"
          :disabled="quarantined || catalogBusy"
          :loading="catalogBusy"
          @click="emit('command', { type: 'refresh-catalog' })"
          ><RefreshCw :size="12"
        /></UiIconButton>
      </div>
      <MixerPluginSection
        class="analysis-inserts"
        :channel="channel"
        :inserts="inserts"
        :runtime="snapshot.runtime"
        :effect-plugins="snapshot.catalog"
        :slot-rows="Math.max(6, inserts.length + (inserts.length < 16 ? 1 : 0))"
        initial-input-width="stereo"
        :editors-enabled="!quarantined"
        :structure-enabled="!quarantined && !catalogBusy"
        @open="emit('command', { type: 'editor', instanceId: $event })"
        @toggle="(instanceId, enabled) => emit('command', { type: 'toggle', instanceId, enabled })"
        @remove="emit('command', { type: 'remove', instanceId: $event })"
        @move="(instanceId, slotOrder) => emit('command', { type: 'move', instanceId, slotOrder })"
        @insert="insert"
      />
    </div>
  </aside>
</template>
<style scoped>
.plugin-analysis-chain {
  display: flex;
  flex-direction: column;
  width: 232px;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  border-right: 1px solid var(--ui-domain-mixer-strip-edge);
  background: var(--ui-domain-mixer-section);
}
.rack {
  display: flex;
  flex-direction: column;
  flex: 1 0 auto;
  margin: 14px 10px;
  border: 1px solid var(--ui-domain-mixer-divider);
  border-radius: 4px;
  overflow: hidden;
}
.analysis-inserts {
  flex: 1;
  border-bottom: 0;
}
.rack-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 4px 7px 0 9px;
  color: var(--ui-domain-mixer-label-ink);
  font-size: var(--ui-type-size-caption);
}
</style>
