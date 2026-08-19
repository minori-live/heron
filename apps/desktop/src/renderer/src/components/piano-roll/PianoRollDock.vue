<script setup lang="ts">
import { provide, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { UiPianoRollViewport, type UiViewportState, type UiWheelIntent } from "@heron/ui"
import { createPianoRollEditor, pianoRollEditorKey } from "./usePianoRollEditor"
import PianoRollToolbar from "./PianoRollToolbar.vue"
import PianoRollInspector from "./PianoRollInspector.vue"
import PianoRollGrid from "./PianoRollGrid.vue"
import PianoRollVelocityLane from "./PianoRollVelocityLane.vue"

const emit = defineEmits<{ close: [] }>()
const editor = createPianoRollEditor()
provide(pianoRollEditorKey, editor)
const { pianoRollStore } = editor
const { t } = useI18n()

const scrollLeft = shallowRef(0)
const scrollTop = shallowRef(0)
const initialized = shallowRef(false)

const RULER_HEIGHT_PX = 28
const KEYBOARD_WIDTH_PX = 72

function handleViewport(state: UiViewportState): void {
  if (!initialized.value) {
    const focusKey = editor.activeClip.value?.notes[0]?.key ?? 60
    scrollTop.value = Math.max(0, (127 - focusKey) * pianoRollStore.rowHeight - state.height / 2)
    const clip = editor.activeClip.value
    if (clip) {
      scrollLeft.value = Math.max(
        0,
        clip.startTick * editor.pixelsPerTick.value + KEYBOARD_WIDTH_PX - state.width / 2
      )
    }
    initialized.value = true
  } else {
    scrollLeft.value = state.scrollLeft
    scrollTop.value = state.scrollTop
  }
}

function handleWheel(intent: UiWheelIntent): void {
  if (intent.modifiers.alt) {
    const contentY = intent.point.y + scrollTop.value - RULER_HEIGHT_PX
    const row = contentY / pianoRollStore.rowHeight
    const previous = pianoRollStore.rowHeight
    pianoRollStore.setRowHeight(previous + (intent.delta.y < 0 ? 2 : -2))
    const next = pianoRollStore.rowHeight
    if (next !== previous) scrollTop.value += row * (next - previous)
    return
  }
  const contentX = intent.point.x + scrollLeft.value - KEYBOARD_WIDTH_PX
  const previousPixelsPerTick = editor.pixelsPerTick.value
  const tick = contentX / previousPixelsPerTick
  pianoRollStore.setPixelsPerQuarter(
    pianoRollStore.pixelsPerQuarter * (intent.delta.y < 0 ? 1.25 : 0.8)
  )
  const nextPixelsPerTick = editor.pixelsPerTick.value
  if (nextPixelsPerTick !== previousPixelsPerTick) {
    scrollLeft.value += tick * (nextPixelsPerTick - previousPixelsPerTick)
  }
}

function close(): void {
  pianoRollStore.closeEditor()
  emit("close")
}
</script>

<template>
  <section class="piano-roll" :aria-label="t('pianoRoll.dock.ariaLabel')">
    <PianoRollToolbar class="toolbar-area" @close="close" />
    <PianoRollInspector class="inspector-area" />
    <div class="editor-main">
      <UiPianoRollViewport
        class="viewport"
        :label="t('pianoRoll.dock.noteGrid')"
        :scroll-left="scrollLeft"
        :scroll-top="scrollTop"
        @focus-change="pianoRollStore.editorFocused = $event"
        @keyboard="editor.handleKeydown"
        @wheel="handleWheel"
        @viewport="handleViewport"
      >
        <PianoRollGrid />
      </UiPianoRollViewport>
      <PianoRollVelocityLane
        v-if="pianoRollStore.showVelocityLane"
        :scroll-left="scrollLeft"
        @update-scroll-left="scrollLeft = $event"
      />
    </div>
    <p v-if="editor.mixerError.value" class="error" role="alert">{{ editor.mixerError.value }}</p>
  </section>
</template>

<style scoped>
.piano-roll {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: var(--ui-control-md) minmax(0, 1fr);
  grid-template-columns: 168px minmax(0, 1fr);
  grid-template-areas:
    "toolbar toolbar"
    "inspector viewport";
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border-top: 1px solid var(--line-strong);
  background: var(--daw-workspace);
}

.toolbar-area {
  grid-area: toolbar;
}

.inspector-area {
  grid-area: inspector;
}

.editor-main {
  display: flex;
  grid-area: viewport;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.viewport {
  position: relative;
  z-index: var(--ui-z-local-base);
  isolation: isolate;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  outline: none;
}

.error {
  position: absolute;
  right: var(--ui-space-3);
  bottom: var(--ui-space-2);
  margin: 0;
  padding: var(--ui-space-2);
  color: var(--ui-color-danger);
  background: var(--surface-1);
}
</style>
