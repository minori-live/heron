<script setup lang="ts">
import { shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { UiResizeHandle, type UiGestureIntent } from "@heron/ui"
import { useStudioWorkspaceStore } from "../../stores/studioWorkspace"
import ArrangementWorkspace from "./ArrangementWorkspace.vue"
import MixerConsole from "../mixer/MixerConsole.vue"
import PianoRollDock from "../piano-roll/PianoRollDock.vue"

const { t } = useI18n()

defineProps<{
  recordingId: string | null
  recordingStartedAt: number | null
  recordingStartFrame: number | null
  recordingStartTick?: number | null
  recordingAudioTrackIds?: string[]
  recordingMidiTrackIds?: string[]
  recordingError: string
}>()

const workspaceStore = useStudioWorkspaceStore()
const resizing = shallowRef(false)
const resizeStartHeight = shallowRef(0)

function resizeDock(intent: UiGestureIntent): void {
  if (intent.phase === "start") {
    resizing.value = true
    resizeStartHeight.value = workspaceStore.mixerDockHeight
  } else if (intent.phase === "update" || intent.phase === "commit") {
    workspaceStore.setDockHeight(
      (resizing.value ? resizeStartHeight.value : workspaceStore.mixerDockHeight) - intent.delta.y
    )
    if (intent.phase === "commit") resizing.value = false
  } else {
    workspaceStore.setDockHeight(resizeStartHeight.value)
    resizing.value = false
  }
}
</script>

<template>
  <section class="block min-h-0 min-w-0 overflow-hidden bg-[var(--daw-workspace)]">
    <div class="arrangement-mode relative flex h-full min-h-0 min-w-0 flex-col">
      <ArrangementWorkspace
        :recording-id="recordingId"
        :recording-started-at="recordingStartedAt"
        :recording-start-frame="recordingStartFrame"
        :recording-start-tick="recordingStartTick"
        :recording-audio-track-ids="recordingAudioTrackIds"
        :recording-midi-track-ids="recordingMidiTrackIds"
        :recording-error="recordingError"
      />
      <UiResizeHandle
        v-if="workspaceStore.lowerDockOpen"
        class="dock-resizer relative z-[var(--ui-z-local-controls)] mt-[-2px] h-[5px] flex-none cursor-ns-resize border-b border-b-solid border-t border-t-solid bg-[var(--daw-resizer)] [border-bottom-color:var(--line-soft)] [border-top-color:var(--line-strong)]"
        :class="{ active: resizing }"
        axis="vertical"
        :label="t('studio.arrangement.resizeMixerDockAria')"
        :value="workspaceStore.mixerDockHeight"
        :minimum="190"
        :maximum="480"
        @gesture="resizeDock"
      />
      <div
        v-if="workspaceStore.lowerDockOpen"
        class="flex min-h-0 flex-none flex-col overflow-hidden"
        :style="workspaceStore.dockStyle"
      >
        <MixerConsole v-if="workspaceStore.activeLowerDock === 'mixer'" class="min-h-0 flex-1" />
        <PianoRollDock v-else @close="workspaceStore.closeLowerDock" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.arrangement-mode > :first-child {
  min-height: 120px;
  flex: 1;
}
.dock-resizer::after {
  content: "";
  position: absolute;
  top: 1px;
  left: 50%;
  width: 32px;
  height: 1px;
  transform: translateX(-50%);
  background: var(--text-faint);
}
.dock-resizer.active {
  background: var(--surface-active);
}
</style>
