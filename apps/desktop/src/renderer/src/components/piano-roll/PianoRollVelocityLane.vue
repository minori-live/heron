<script setup lang="ts">
import { computed, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { UiVelocityLane, type UiGestureIntent, type UiVelocityBar } from "@heron/ui"
import type { ProjectCommand } from "@heron/contracts"
import { usePianoRollEditor } from "./usePianoRollEditor"
import type { NoteGestureItem } from "./usePianoRollGestures"

const props = defineProps<{ scrollLeft: number }>()
const emit = defineEmits<{ updateScrollLeft: [value: number] }>()

const {
  pianoRollStore,
  visibleNotes,
  pixelsPerTick,
  gridWidth,
  displayedNoteValues,
  formatMidiNoteName,
  trackColor,
  batch
} = usePianoRollEditor()
const { t } = useI18n()

const BAR_WIDTH_PX = 5
const BAR_HIT_TOLERANCE_PX = 3

function updateScroll(value: number): void {
  emit("updateScrollLeft", value)
}

interface VelocityDrag {
  mode: "level" | "paint"
  targets: NoteGestureItem[]
  previews: Map<string, number>
}

const drag = shallowRef<VelocityDrag | null>(null)

const noteKey = (item: NoteGestureItem): string => `${item.clip.id}:${item.note.id}`

function barLeft(item: NoteGestureItem): number {
  return displayedNoteValues(item.clip, item.note).globalStartTick * pixelsPerTick.value
}

function displayedVelocity(item: NoteGestureItem): number {
  return drag.value?.previews.get(noteKey(item)) ?? item.note.velocity
}

function lanePoint(intent: UiGestureIntent): { x: number; velocity: number } {
  const x = intent.point.x
  const ratio = 1 - intent.point.y / 110
  return { x, velocity: Math.max(1, Math.min(127, Math.round(ratio * 127))) }
}

function barsAt(x: number): NoteGestureItem[] {
  return visibleNotes.value.filter((item) => {
    const left = barLeft(item)
    return x >= left - BAR_HIT_TOLERANCE_PX && x <= left + BAR_WIDTH_PX + BAR_HIT_TOLERANCE_PX
  })
}

function applyLevel(current: VelocityDrag, velocity: number): VelocityDrag {
  const previews = new Map(current.previews)
  for (const target of current.targets) {
    if (target.note.velocity !== velocity || previews.has(noteKey(target))) {
      previews.set(noteKey(target), velocity)
    }
  }
  return { ...current, previews }
}

function applyPaint(current: VelocityDrag, x: number, velocity: number): VelocityDrag {
  const previews = new Map(current.previews)
  for (const item of barsAt(x)) previews.set(noteKey(item), velocity)
  return { ...current, previews }
}

function startGesture(intent: UiGestureIntent): void {
  const point = lanePoint(intent)
  const hits = barsAt(point.x)
  if (hits.length === 0) {
    drag.value = { mode: "paint", targets: [], previews: new Map() }
    return
  }
  const selected = pianoRollStore.selectedNoteKeys
  const anySelected = hits.some((item) => selected.has(noteKey(item)))
  const targets = anySelected
    ? visibleNotes.value.filter((item) => selected.has(noteKey(item)))
    : hits
  drag.value = applyLevel({ mode: "level", targets, previews: new Map() }, point.velocity)
}

function updateGesture(intent: UiGestureIntent): void {
  const current = drag.value
  if (!current) return
  const point = lanePoint(intent)
  drag.value =
    current.mode === "level"
      ? applyLevel(current, point.velocity)
      : applyPaint(current, point.x, point.velocity)
}

function commitGesture(): void {
  const current = drag.value
  drag.value = null
  if (!current) return
  const byClip = new Map<string, Array<{ noteId: string; patch: { velocity: number } }>>()
  for (const item of visibleNotes.value) {
    const velocity = current.previews.get(noteKey(item))
    if (velocity === undefined || velocity === item.note.velocity) continue
    const updates = byClip.get(item.clip.id) ?? []
    updates.push({ noteId: item.note.id, patch: { velocity } })
    byClip.set(item.clip.id, updates)
  }
  if (byClip.size === 0) return
  const commands: ProjectCommand[] = [...byClip].map(([clipId, updates]) => ({
    type: "update-midi-notes",
    clipId,
    updates
  }))
  void batch(commands)
}

function cancelDrag(): void {
  drag.value = null
}

function handleGesture(intent: UiGestureIntent): void {
  if (intent.phase === "start") startGesture(intent)
  else if (intent.phase === "update") updateGesture(intent)
  else if (intent.phase === "commit") commitGesture()
  else cancelDrag()
}

const bars = computed<UiVelocityBar[]>(() =>
  visibleNotes.value.map((item) => ({
    id: noteKey(item),
    x: barLeft(item),
    width: BAR_WIDTH_PX,
    height: (displayedVelocity(item) / 127) * 100,
    color: trackColor(item.clip),
    label: barAriaLabel(item),
    selected: pianoRollStore.selectedNoteKeys.has(noteKey(item)),
    inactive: item.clip.id !== pianoRollStore.activeClipId
  }))
)

function barAriaLabel(item: NoteGestureItem): string {
  return t("pianoRoll.velocityLane.barLabel", {
    velocity: displayedVelocity(item),
    note: formatMidiNoteName(item.note.key),
    clip: item.clip.name
  })
}
</script>

<template>
  <UiVelocityLane
    :width="gridWidth"
    :label="t('pianoRoll.velocityLane.ariaLabel')"
    :header="t('pianoRoll.velocityLane.header')"
    :bars="bars"
    :scroll-left="props.scrollLeft"
    @update-scroll-left="updateScroll"
    @gesture="handleGesture"
  />
</template>
