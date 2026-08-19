<script setup lang="ts">
import { computed } from "vue"
import { UiPianoKeyboard } from "@heron/ui"
import { usePianoRollEditor } from "./usePianoRollEditor"
const { pianoRollStore, isBlackKey, formatMidiNoteName } = usePianoRollEditor()
const keys = computed(() =>
  Array.from({ length: 128 }, (_, key) => ({
    key,
    label: formatMidiNoteName(key),
    black: isBlackKey(key)
  }))
)
</script>
<template>
  <UiPianoKeyboard
    :keys="keys"
    :row-height="pianoRollStore.rowHeight"
    label="Piano keyboard"
    @select="pianoRollStore.editCursorKey = $event"
  />
</template>
