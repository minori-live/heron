<script setup lang="ts">
import type { MidiClipState, MidiNoteState } from "@heron/contracts"
import { UiPianoRollNote } from "@heron/ui"
import { usePianoRollEditor } from "./usePianoRollEditor"

const props = defineProps<{ clip: MidiClipState; note: MidiNoteState }>()

const {
  pianoRollStore,
  gestureNotePreviews,
  eraseTargetKeys,
  noteStyle,
  noteAriaLabel,
  displayedNoteValues,
  formatMidiNoteName,
  handleNoteGesture,
  handleNoteClick,
  handleNotePointerOver
} = usePianoRollEditor()
</script>

<template>
  <UiPianoRollNote
    class="note"
    :model="{
      id: `${props.clip.id}:${props.note.id}`,
      label: noteAriaLabel(props.clip, props.note),
      selected: pianoRollStore.selectedNoteKeys.has(`${props.clip.id}:${props.note.id}`),
      inactive: props.clip.id !== pianoRollStore.activeClipId,
      previewing: gestureNotePreviews.has(`${props.clip.id}:${props.note.id}`),
      erasing: eraseTargetKeys.has(`${props.clip.id}:${props.note.id}`)
    }"
    :style="noteStyle(props.clip, props.note)"
    @select="handleNoteClick($event, props.clip, props.note)"
    @gesture="(mode, intent) => handleNoteGesture(mode, intent, props.clip, props.note)"
    @hover="handleNotePointerOver(props.clip, props.note)"
  >
    {{ formatMidiNoteName(displayedNoteValues(props.clip, props.note).key) }}
  </UiPianoRollNote>
</template>

<style scoped>
.note {
  position: absolute;
  z-index: var(--ui-z-local-raised);
  display: flex;
  min-width: 2px;
  align-items: center;
  overflow: hidden;
  padding: 0 4px;
  border: 1px solid color-mix(in srgb, var(--note-color) 65%, var(--line-strong));
  border-radius: 2px;
  color: var(--canvas);
  background: color-mix(
    in srgb,
    var(--note-color) calc(38% + 62% * var(--note-velocity, 1)),
    var(--surface-sunken)
  );
}

.note.inactive {
  opacity: 0.58;
}

.note.selected {
  z-index: var(--ui-z-local-selection);
  outline: 2px solid var(--focus);
  outline-offset: 0;
  opacity: 1;
}

.note.previewing {
}

.note.erasing {
  opacity: 0.25;
  pointer-events: none;
}

.note-label {
  overflow: hidden;
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  text-overflow: clip;
  white-space: nowrap;
  pointer-events: none;
}

.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 5px;
}

.resize-handle.left {
  left: 0;
}

.resize-handle.right {
  right: 0;
}
</style>
