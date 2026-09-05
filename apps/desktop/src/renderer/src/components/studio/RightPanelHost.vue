<script setup lang="ts">
import { shallowRef } from "vue"
import { UiResizeHandle, type UiGestureIntent } from "@heron/ui"
import { useI18n } from "vue-i18n"
import { useStudioWorkspaceStore } from "../../stores/studioWorkspace"
import MediaBrowserPanel from "../media-browser/MediaBrowserPanel.vue"
import NotesPanel from "../notes/NotesPanel.vue"

const { t } = useI18n()
const workspaceStore = useStudioWorkspaceStore()
const DEFAULT_PANEL_WIDTH = 320
const startWidth = shallowRef(workspaceStore.rightPanelWidth)
const resizing = shallowRef(false)
function resize(intent: UiGestureIntent): void {
  if (intent.phase === "start") {
    startWidth.value = workspaceStore.rightPanelWidth
    resizing.value = true
  } else if (intent.phase === "update") {
    workspaceStore.setRightPanelWidth(startWidth.value - intent.delta.x)
  } else if (intent.phase === "commit") {
    workspaceStore.setRightPanelWidth(
      resizing.value
        ? startWidth.value - intent.delta.x
        : workspaceStore.rightPanelWidth - intent.delta.x
    )
    resizing.value = false
  } else {
    workspaceStore.setRightPanelWidth(startWidth.value)
    resizing.value = false
  }
}
</script>

<template>
  <div class="right-panel-host" :style="{ width: `${workspaceStore.rightPanelWidth}px` }">
    <UiResizeHandle
      class="right-panel-resizer"
      axis="horizontal"
      :label="t('studio.mediaBrowser.resizeAria')"
      :keyboard-step="10"
      :value="workspaceStore.rightPanelWidth"
      :minimum="260"
      :maximum="480"
      reset-on-double-click
      @gesture="resize"
      @reset="workspaceStore.setRightPanelWidth(DEFAULT_PANEL_WIDTH)"
    />
    <NotesPanel v-if="workspaceStore.activeRightPanel === 'notes'" />
    <MediaBrowserPanel v-else />
  </div>
</template>

<style scoped>
.right-panel-host {
  position: relative;
  min-width: 260px;
  max-width: 480px;
  min-height: 0;
}
.right-panel-resizer {
  position: absolute;
  z-index: var(--ui-z-local-controls);
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
}
.right-panel-resizer::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: var(--line-strong);
}
</style>
