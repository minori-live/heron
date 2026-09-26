<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { PanelLeft, Settings2, SlidersHorizontal } from "@lucide/vue"
import { DEFAULT_METER_RETURN_RATE } from "@heron/contracts"
import type {
  MixerChannelCoreState,
  MixerChannelMeter,
  MixerChannelPatch,
  MixerParameterPreview
} from "@heron/contracts"
import WorkspaceTopbar from "../workspace/WorkspaceTopbar.vue"
import WorkspaceControlButton from "../workspace/WorkspaceControlButton.vue"
import WorkspaceControlGroup from "../workspace/WorkspaceControlGroup.vue"
import WorkspaceMasterControl from "../workspace/WorkspaceMasterControl.vue"

const props = defineProps<{
  name: string
  dirty: boolean
  pending: boolean
  leftPanelOpen: boolean
  mixerOpen: boolean
  master: MixerChannelCoreState | null
}>()
defineEmits<{
  toggleLeftPanel: []
  toggleMixer: []
  configure: []
  preview: [value: MixerParameterPreview]
  updateChannel: [id: string, patch: MixerChannelPatch]
}>()
const { t } = useI18n()
const silentMasterMeter = computed<MixerChannelMeter>(() => ({
  channelId: props.master?.id ?? "",
  preFaderPeak: [0, 0],
  postFaderPeak: [0, 0],
  heldPeak: [0, 0],
  clipped: false
}))
</script>

<template>
  <WorkspaceTopbar>
    <WorkspaceControlGroup>
      <WorkspaceControlButton
        :label="t('live.document')"
        :pressed="leftPanelOpen"
        @activate="$emit('toggleLeftPanel')"
      >
        <PanelLeft :size="16" />
      </WorkspaceControlButton>
    </WorkspaceControlGroup>
    <div class="live-document-title flex min-w-0 items-center justify-center gap-ui-3">
      <span class="truncate text-ui-sm text-ui-text" :title="name">{{ name }}</span>
      <span v-if="dirty" class="text-ui-text-muted" :aria-label="t('live.unsaved')">•</span>
      <span class="text-ui-xs text-ui-text-muted">{{ t("live.editMode") }}</span>
    </div>
    <div class="flex flex-none items-center gap-ui-3">
      <WorkspaceControlGroup>
        <WorkspaceControlButton
          :label="t('live.devices')"
          :disabled="pending"
          @activate="$emit('configure')"
        >
          <Settings2 :size="16" />
        </WorkspaceControlButton>
        <WorkspaceControlButton
          :label="t('live.mixer')"
          :pressed="mixerOpen"
          @activate="$emit('toggleMixer')"
        >
          <SlidersHorizontal :size="16" />
        </WorkspaceControlButton>
      </WorkspaceControlGroup>
      <WorkspaceMasterControl
        :channel="master"
        :disabled="pending"
        :meter="silentMasterMeter"
        meter-peak-hold="800ms"
        :meter-return-rate="DEFAULT_METER_RETURN_RATE"
        @preview="$emit('preview', $event)"
        @update-channel="(id, patch) => $emit('updateChannel', id, patch)"
      />
    </div>
  </WorkspaceTopbar>
</template>
