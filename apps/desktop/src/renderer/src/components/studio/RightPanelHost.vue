<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { useStudioWorkspaceStore } from "../../stores/studioWorkspace"
import MediaBrowserPanel from "../media-browser/MediaBrowserPanel.vue"
import NotesPanel from "../notes/NotesPanel.vue"
import WorkspaceSidePanel from "../workspace/WorkspaceSidePanel.vue"

const { t } = useI18n()
const workspaceStore = useStudioWorkspaceStore()
const panelWidth = computed({
  get: () => workspaceStore.rightPanelWidth,
  set: (value: number) => workspaceStore.setRightPanelWidth(value)
})
</script>

<template>
  <WorkspaceSidePanel
    v-model="panelWidth"
    class="right-panel-host"
    :label="
      workspaceStore.activeRightPanel === 'notes'
        ? t('studio.notes.title')
        : t('studio.mediaBrowser.title')
    "
    :resize-label="t('studio.mediaBrowser.resizeAria')"
    :minimum="260"
    :maximum="480"
    :default-width="320"
  >
    <NotesPanel v-if="workspaceStore.activeRightPanel === 'notes'" />
    <MediaBrowserPanel v-else />
  </WorkspaceSidePanel>
</template>
