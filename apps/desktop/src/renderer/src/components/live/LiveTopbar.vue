<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { FolderClosed, PanelLeft, Save, Settings2, SlidersHorizontal } from "@lucide/vue"
import type {
  MixerChannelCoreState,
  MixerChannelMeter,
  MixerChannelPatch,
  MixerParameterPreview
} from "@heron/contracts"
import WorkspaceTopbar from "../studio/WorkspaceTopbar.vue"
import StudioControlButton from "../studio/topbar/StudioControlButton.vue"
import StudioMasterControl from "../studio/topbar/StudioMasterControl.vue"

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
  save: []
  close: []
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
    <div class="control-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]">
      <StudioControlButton
        :label="t('live.document')"
        :pressed="leftPanelOpen"
        @activate="$emit('toggleLeftPanel')"
      >
        <PanelLeft :size="16" />
      </StudioControlButton>
      <StudioControlButton
        :label="t('menu.closeProject')"
        :disabled="pending"
        @activate="$emit('close')"
      >
        <FolderClosed :size="16" />
      </StudioControlButton>
      <StudioControlButton
        :label="t('menu.saveProject')"
        :disabled="pending"
        @activate="$emit('save')"
      >
        <Save :size="16" />
      </StudioControlButton>
    </div>
    <div class="live-document-title flex min-w-0 items-center justify-center gap-ui-3">
      <span class="truncate text-ui-sm text-ui-text" :title="name">{{ name }}</span>
      <span v-if="dirty" class="text-ui-text-muted" :aria-label="t('live.unsaved')">•</span>
      <span class="text-ui-xs text-ui-text-muted">{{ t("live.editMode") }}</span>
    </div>
    <div class="flex flex-none items-center gap-ui-3">
      <div class="control-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]">
        <StudioControlButton
          :label="t('live.devices')"
          :disabled="pending"
          @activate="$emit('configure')"
        >
          <Settings2 :size="16" />
        </StudioControlButton>
        <StudioControlButton
          :label="t('live.mixer')"
          :pressed="mixerOpen"
          @activate="$emit('toggleMixer')"
        >
          <SlidersHorizontal :size="16" />
        </StudioControlButton>
      </div>
      <StudioMasterControl
        :channel="master"
        :disabled="pending"
        :meter="silentMasterMeter"
        @preview="$emit('preview', $event)"
        @update-channel="(id, patch) => $emit('updateChannel', id, patch)"
      />
    </div>
  </WorkspaceTopbar>
</template>
