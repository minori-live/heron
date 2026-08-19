<script setup lang="ts">
import { computed, shallowRef } from "vue"
import {
  UiAutomationLane,
  type UiAutomationLanePoint,
  type UiGestureIntent,
  type UiPoint
} from "@heron/ui"

export interface GlobalMarkerLanePoint {
  id: string
  position: number
  label: string
  lockTime?: boolean
  lockRemoval?: boolean
}

const props = defineProps<{
  points: GlobalMarkerLanePoint[]
  selectedId: string | null
  contentWidth: number
  pixelsPerUnit: number
  height: number
  beatGuides: number[]
  verticalGuides: number[]
  color: string
  valueLabel: string
  positionLabel: string
}>()

const emit = defineEmits<{
  create: [position: number]
  update: [id: string, position: number]
  remove: [id: string]
  select: [id: string | null]
}>()

const drag = shallowRef<{ id: string; position: number } | null>(null)
const sortedPoints = computed(() =>
  [...props.points].sort((left, right) => left.position - right.position)
)
const renderedPoints = computed(() =>
  sortedPoints.value.map((point) =>
    drag.value?.id === point.id ? { ...point, position: drag.value.position } : point
  )
)
const segments = computed(() =>
  renderedPoints.value.map((point, index) => ({
    ...point,
    left: positionToX(point.position),
    width: Math.max(
      0,
      (renderedPoints.value[index + 1]
        ? positionToX(renderedPoints.value[index + 1]!.position)
        : props.contentWidth) - positionToX(point.position)
    )
  }))
)

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function positionToX(position: number): number {
  return position * props.pixelsPerUnit
}

function positionFromPoint(point: UiPoint): number {
  return clamp(point.x, 0, props.contentWidth) / props.pixelsPerUnit
}

function createPoint(point: UiPoint): void {
  emit("create", positionFromPoint(point))
}

function startDrag(point: GlobalMarkerLanePoint): void {
  emit("select", point.id)
  drag.value = { id: point.id, position: point.position }
}

function updateDrag(intent: UiGestureIntent): void {
  const current = drag.value
  if (!current) return
  const source = props.points.find((point) => point.id === current.id)
  if (!source) return
  drag.value = {
    id: current.id,
    position: source.lockTime ? source.position : positionFromPoint(intent.point)
  }
}

function finishDrag(commit = true): void {
  const current = drag.value
  if (!current) return
  drag.value = null
  if (commit) emit("update", current.id, current.position)
}

function handlePointGesture(id: string, intent: UiGestureIntent): void {
  const point = props.points.find((candidate) => candidate.id === id)
  if (!point) return
  if (intent.phase === "start") startDrag(point)
  else if (intent.phase === "update") updateDrag(intent)
  else if (intent.phase === "commit") finishDrag()
  else finishDrag(false)
}

const uiPoints = computed<UiAutomationLanePoint[]>(() =>
  segments.value.map((point) => ({
    id: point.id,
    x: point.left,
    y: 0,
    label: `${props.valueLabel} ${point.label} at ${point.position.toFixed(2)} ${props.positionLabel}`,
    selected: point.id === props.selectedId,
    segmentWidth: point.width,
    segmentLabel: point.label,
    removable: !point.lockRemoval
  }))
)
</script>

<template>
  <UiAutomationLane
    mode="marker"
    :label="`${valueLabel} global track editor. Double-click to add an event.`"
    :width="contentWidth"
    :height="height"
    :color="color"
    :points="uiPoints"
    :beat-guides="beatGuides"
    :vertical-guides="verticalGuides"
    @create="createPoint"
    @clear-selection="emit('select', null)"
    @point-gesture="handlePointGesture"
    @remove="emit('remove', $event)"
  />
</template>
