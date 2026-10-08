<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import { RefreshCw } from "@lucide/vue"
import { UiCheckbox, UiIconButton, UiSegmentedControl } from "@heron/ui"
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
}>()
const emit = defineEmits<{ command: [command: PluginAnalysisCommand] }>()
const { t } = useI18n()
const quarantined = computed(() => props.snapshot.status === "quarantined")
const activeChain = ref("0")
const chain = computed<0 | 1>(() =>
  props.snapshot.comparisonEnabled && activeChain.value === "1" ? 1 : 0
)
const chainId = computed(() =>
  chain.value === 0 ? props.snapshot.ref.id : `${props.snapshot.ref.id}:comparison`
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
    chain: chain.value,
    pluginKey: pluginDescriptorKey(selection.descriptor),
    audioMode: selection.audioMode,
    slotOrder
  })
}
</script>
<template>
  <aside class="plugin-analysis-chain">
    <div class="chain-controls">
      <UiCheckbox
        :model-value="snapshot.comparisonEnabled"
        :label="t('pluginAnalysis.compareChains')"
        :disabled="quarantined"
        @update:model-value="emit('command', { type: 'comparison', enabled: $event })"
      />
      <UiSegmentedControl
        v-if="snapshot.comparisonEnabled"
        v-model="activeChain"
        class="chain-switch"
        :options="[
          { value: '0', label: t('pluginAnalysis.chain1') },
          { value: '1', label: t('pluginAnalysis.chain2') }
        ]"
        :label="t('pluginAnalysis.chain')"
        size="compact"
        required
      />
    </div>
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
        :slot-rows="inserts.length + (inserts.length < 16 ? 1 : 0)"
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
  flex: none;
  gap: 12px;
  width: 240px;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  border-right: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface);
}
.chain-controls {
  --ui-type-size-control: var(--ui-type-size-section-title);
  --ui-type-size-caption: var(--ui-type-size-label);
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: var(--ui-type-size-caption);
}
.chain-switch {
  display: flex;
}
.chain-switch > :deep(*) {
  flex: 1;
}
/* The insert rack keeps the Mixer's strip chrome so slots read exactly as they do there. */
.rack {
  display: flex;
  flex-direction: column;
  flex: none;
  border: 1px solid var(--ui-domain-mixer-strip-edge);
  border-radius: var(--ui-radius-sm);
  overflow: hidden;
  background: var(--ui-domain-mixer-section);
}
.analysis-inserts {
  border-bottom: 0;
}
.rack-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 4px 4px 2px 9px;
  color: var(--ui-domain-mixer-label-ink);
  font-size: var(--ui-type-size-label);
}
</style>
