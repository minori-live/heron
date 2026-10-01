<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { PanelLeft, Settings2, SlidersHorizontal } from "@lucide/vue"
import { DEFAULT_METER_RETURN_RATE } from "@heron/contracts"
import { UiButton } from "@heron/ui"
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
  editingLayer?: string
  performing?: boolean
  activeLayer?: string
  masterMeter?: MixerChannelMeter
  uncapturedCount?: number
  adjusting?: boolean
  quarantined?: boolean
}>()
defineEmits<{
  toggleLeftPanel: []
  toggleMixer: []
  configure: []
  enterPerform: []
  leavePerform: []
  capture: []
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
      <span
        class="truncate text-ui-xs text-ui-text-muted"
        :title="performing ? activeLayer : editingLayer"
        >{{
          t(
            quarantined
              ? "live.performance.recoveryMode"
              : performing
                ? "live.performance.mode"
                : "live.editMode"
          )
        }}<template v-if="performing"> · {{ activeLayer }}</template
        ><template v-else-if="editingLayer"> · {{ editingLayer }}</template></span
      >
    </div>
    <div class="flex flex-none items-center gap-ui-3">
      <UiButton
        v-if="!performing"
        size="sm"
        variant="primary"
        :disabled="pending"
        @click="$emit('enterPerform')"
      >
        {{ t("live.performance.enter") }}
      </UiButton>
      <template v-else>
        <UiButton size="sm" :disabled="pending" @click="$emit('capture')">
          {{ t("live.performance.captureShort")
          }}<template v-if="uncapturedCount"> · {{ uncapturedCount }}</template>
        </UiButton>
        <UiButton size="sm" :disabled="pending" @click="$emit('leavePerform')">{{
          t("live.performance.leave")
        }}</UiButton>
      </template>
      <WorkspaceControlGroup>
        <WorkspaceControlButton
          :label="t('live.devices')"
          :disabled="pending || performing"
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
        :disabled="pending && !adjusting"
        :meter="masterMeter ?? silentMasterMeter"
        meter-peak-hold="800ms"
        :meter-return-rate="DEFAULT_METER_RETURN_RATE"
        @preview="$emit('preview', $event)"
        @update-channel="(id, patch) => $emit('updateChannel', id, patch)"
      />
    </div>
  </WorkspaceTopbar>
</template>
