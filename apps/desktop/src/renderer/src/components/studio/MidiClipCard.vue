<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiContextMenu, UiTimelineClip, type UiGestureIntent, type UiMenuEntry } from "@heron/ui"
import type { MidiClipState, TempoMapSnapshot } from "@heron/contracts"
import type { PianoRollSnap } from "../../utils/pianoRoll"
import type { ClipTrimEdge } from "../../utils/clipEditing"
import { useMidiClipTrim } from "./useMidiClipTrim"

const props = defineProps<{
  clip: MidiClipState
  tempoMap: TempoMapSnapshot
  pixelsPerQuarter: number
  trackColor: string
  selectedClipIds: string[]
  playheadTick: number
  snap: PianoRollSnap
  dragging: boolean
}>()

const emit = defineEmits<{
  remove: [clipId: string]
  select: [clipId: string, additive: boolean]
  open: [clipId: string, selectedClipIds: string[]]
  split: [clipId: string]
  trim: [clipId: string, edge: ClipTrimEdge, tick: number]
  dragStart: [clipId: string, offsetPixels: number]
  dragEnd: []
}>()

const { t } = useI18n()
const selected = computed(() => props.selectedClipIds.includes(props.clip.id))
const canEditAtPlayhead = computed(
  () =>
    props.playheadTick > props.clip.startTick &&
    props.playheadTick < props.clip.startTick + props.clip.lengthTicks
)
const menuEntries = computed<readonly UiMenuEntry[]>(() => [
  { kind: "item", id: "open", label: t("studio.arrangement.openMidiClip"), shortcut: "Enter" },
  {
    kind: "item",
    id: "split",
    label: t("studio.arrangement.splitAtPlayhead"),
    disabled: !canEditAtPlayhead.value
  },
  {
    kind: "item",
    id: "trim-start",
    label: t("studio.arrangement.trimStartToPlayhead"),
    disabled: !canEditAtPlayhead.value
  },
  {
    kind: "item",
    id: "trim-end",
    label: t("studio.arrangement.trimEndToPlayhead"),
    disabled: !canEditAtPlayhead.value
  },
  { kind: "separator", id: "delete-separator" },
  { kind: "item", id: "delete", label: t("studio.arrangement.deleteClip"), tone: "danger" }
])
const { active, preview, gesture } = useMidiClipTrim({
  clip: () => props.clip,
  pixelsPerQuarter: () => props.pixelsPerQuarter,
  ticksPerQuarter: () => props.tempoMap.ticksPerQuarter,
  snap: () => props.snap,
  commit: (edge, tick) => emit("trim", props.clip.id, edge, tick)
})
const displayedClip = computed(() => preview.value ?? props.clip)
const clipStyle = computed(() => {
  const pixelsPerTick = props.pixelsPerQuarter / props.tempoMap.ticksPerQuarter
  return {
    left: `${displayedClip.value.startTick * pixelsPerTick}px`,
    width: `${Math.max(9, displayedClip.value.lengthTicks * pixelsPerTick)}px`,
    borderColor: props.trackColor,
    background: `color-mix(in srgb, ${props.trackColor} 20%, var(--surface-sunken))`
  }
})

function noteStyle(note: MidiClipState["notes"][number]) {
  const left =
    ((note.startTick - displayedClip.value.sourceOffsetTicks) / displayedClip.value.lengthTicks) *
    100
  const width = Math.max(0.8, (note.durationTicks / displayedClip.value.lengthTicks) * 100)
  return {
    left: `${left}%`,
    width: `${width}%`,
    bottom: `${(note.key / 127) * 72 + 8}%`,
    background: props.trackColor
  }
}

function trimGesture(action: string, intent: UiGestureIntent): void {
  gesture(action === "trim-start" ? "start" : "end", intent)
}

function selectMenuAction(id: string): void {
  if (id === "open")
    emit("open", props.clip.id, selected.value ? props.selectedClipIds : [props.clip.id])
  else if (id === "split") emit("split", props.clip.id)
  else if (id === "trim-start") emit("trim", props.clip.id, "start", props.playheadTick)
  else if (id === "trim-end") emit("trim", props.clip.id, "end", props.playheadTick)
  else if (id === "delete") emit("remove", props.clip.id)
}
</script>

<template>
  <UiContextMenu
    :entries="menuEntries"
    :menu-label="t('studio.arrangement.midiClipMenu', { name: clip.name })"
    @open-context="!selected && emit('select', clip.id, false)"
    @select="selectMenuAction"
  >
    <UiTimelineClip
      class="midi-clip"
      kind="midi"
      :model="{
        id: clip.id,
        label: clip.name,
        start: Number.parseFloat(clipStyle.left),
        width: Number.parseFloat(clipStyle.width),
        selected,
        signalColor: trackColor
      }"
      :aria-label="`${clip.name}, MIDI clip`"
      :label="`${clip.name}, MIDI clip`"
      :open-label="t('studio.arrangement.openMidiClip')"
      :dragging="dragging"
      :editing="Boolean(active)"
      :drag-data="[{ mime: 'application/x-heron-midi-clip', value: clip.id }]"
      :trim-start-label="t('studio.arrangement.trimClipStart', { name: clip.name })"
      :trim-end-label="t('studio.arrangement.trimClipEnd', { name: clip.name })"
      @select="emit('select', clip.id, $event)"
      @open="emit('open', clip.id, selected ? selectedClipIds : [clip.id])"
      @remove="emit('remove', clip.id)"
      @drag-start="emit('dragStart', clip.id, $event)"
      @drag-end="emit('dragEnd')"
      @gesture="trimGesture"
    >
      <span
        v-for="note in displayedClip.notes"
        :key="note.id"
        class="midi-note"
        :style="noteStyle(note)"
      />
    </UiTimelineClip>
  </UiContextMenu>
</template>

<style scoped>
.midi-clip {
  position: absolute;
  top: 5px;
  bottom: 5px;
  overflow: hidden;
  min-width: 9px;
  padding: 4px 7px;
  border: 1px solid;
  border-radius: 3px;
  color: var(--text-primary);
  text-align: left;
}
.midi-clip.trimming {
  z-index: var(--ui-z-local-selection);
}
.midi-clip[aria-pressed="true"] {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
.midi-clip strong {
  position: relative;
  z-index: var(--ui-z-local-raised);
  display: block;
  overflow: hidden;
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}
.midi-note {
  position: absolute;
  height: 2px;
  min-width: 1px;
  border-radius: 1px;
  opacity: 0.9;
  pointer-events: none;
}
.trim-handle {
  position: absolute;
  z-index: var(--ui-z-local-selection);
  top: 0;
  bottom: 0;
  width: 7px;
  touch-action: none;
}
.trim-handle::after {
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--text-primary) 75%, transparent);
  content: "";
  opacity: 0;
}
.trim-handle-start {
  left: 0;
}
.trim-handle-start::after {
  left: 2px;
}
.trim-handle-end {
  right: 0;
}
.trim-handle-end::after {
  right: 2px;
}
</style>
