<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { RefreshCw } from "@lucide/vue"
import { UiIconButton } from "@heron/ui"
import { pluginDescriptorKey, type DoctorCommand, type DoctorSnapshot } from "@heron/contracts"
import type { MixerStripChannel } from "../mixer/mixer-surface-context"
import type { PluginSelection } from "../plugins/plugin-audio-mode"
import MixerPluginSection from "../mixer/MixerPluginSection.vue"
const props = defineProps<{ snapshot: DoctorSnapshot; catalogBusy: boolean }>()
const emit = defineEmits<{ command: [command: DoctorCommand] }>()
const { t } = useI18n()
const quarantined = computed(() => props.snapshot.status === "quarantined")
const channel = computed<MixerStripChannel>(() => ({
  id: props.snapshot.ref.id,
  kind: "audio",
  name: t("doctor.title"),
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
    pluginKey: pluginDescriptorKey(selection.descriptor),
    audioMode: selection.audioMode,
    slotOrder
  })
}
</script>
<template>
  <aside class="doctor-chain">
    <div class="rack">
      <div class="rack-heading">
        <span>{{ t("doctor.inserts") }}</span>
        <UiIconButton
          size="sm"
          variant="ghost"
          :label="t('doctor.rescan')"
          :disabled="quarantined || catalogBusy"
          :loading="catalogBusy"
          @click="emit('command', { type: 'refresh-catalog' })"
          ><RefreshCw :size="12"
        /></UiIconButton>
      </div>
      <MixerPluginSection
        :channel="channel"
        :inserts="snapshot.plugins"
        :runtime="snapshot.runtime"
        :effect-plugins="snapshot.catalog"
        :slot-rows="Math.max(6, snapshot.plugins.length + (snapshot.plugins.length < 16 ? 1 : 0))"
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
.doctor-chain {
  display: flex;
  flex-direction: column;
  width: 232px;
  flex-shrink: 0;
  overflow-y: auto;
  min-height: 0;
  border-right: 1px solid var(--ui-domain-mixer-strip-edge);
  background: var(--ui-domain-mixer-section);
}
.rack {
  margin: 14px 10px 0;
  border: 1px solid var(--ui-domain-mixer-divider);
  border-radius: 4px;
  overflow: hidden;
}
.rack-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 7px 0 9px;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
}
</style>
