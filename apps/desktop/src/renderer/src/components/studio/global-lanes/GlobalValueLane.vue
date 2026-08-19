<script setup lang="ts">
import { computed, shallowRef } from "vue"
import {
  UiAutomationLane,
  type UiAutomationLanePoint,
  type UiGestureIntent,
  type UiPoint
} from "@heron/ui"

export interface GlobalLanePoint {
  id: string
  position: number
  value: number
  lockTime?: boolean
  lockRemoval?: boolean
}

const props = defineProps<{
  points: GlobalLanePoint[]
  selectedId: string | null
  contentWidth: number
  pixelsPerUnit: number
  height: number
  minimum: number
  maximum: number
  guides: number[]
  beatGuides: number[]
  verticalGuides: number[]
  color: string
  valueLabel: string
  positionLabel: string
}>()

const emit = defineEmits<{
  create: [position: number, value: number]
  update: [id: string, position: number, value: number]
  remove: [id: string]
  select: [id: string | null]
}>()

const drag = shallowRef<{
  id: string
  position: number
  value: number
} | null>(null)
const sortedPoints = computed(() =>
  [...props.points].sort((left, right) => left.position - right.position)
)
const renderedPoints = computed(() =>
  sortedPoints.value.map((point) =>
    drag.value?.id === point.id ? { ...point, ...drag.value } : point
  )
)
const linePath = computed(() => {
  const points = renderedPoints.value
  if (points.length === 0) return ""
  const first = points[0]!
  let path = `M 0 ${valueToY(first.value)}`
  for (const point of points.slice(1)) {
    const x = positionToX(point.position)
    path += ` H ${x} V ${valueToY(point.value)}`
  }
  return `${path} H ${props.contentWidth}`
})
const fillPath = computed(() => (linePath.value ? `${linePath.value} V ${props.height} H 0 Z` : ""))

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function positionToX(position: number): number {
  return position * props.pixelsPerUnit
}

function valueToY(value: number): number {
  const range = Math.max(1, props.maximum - props.minimum)
  return ((props.maximum - clamp(value, props.minimum, props.maximum)) / range) * props.height
}

function laneValue(point: UiPoint): {
  position: number
  value: number
} {
  const x = clamp(point.x, 0, props.contentWidth)
  const y = clamp(point.y, 0, props.height)
  return {
    position: x / props.pixelsPerUnit,
    value: props.maximum - (y / props.height) * (props.maximum - props.minimum)
  }
}

function createPoint(source: UiPoint): void {
  const point = laneValue(source)
  emit("create", point.position, point.value)
}

function startDrag(point: GlobalLanePoint): void {
  emit("select", point.id)
  drag.value = {
    id: point.id,
    position: point.position,
    value: point.value
  }
}

function updateDrag(intent: UiGestureIntent): void {
  const current = drag.value
  if (!current) return
  const source = props.points.find((point) => point.id === current.id)
  if (!source) return
  const next = laneValue(intent.point)
  drag.value = {
    id: current.id,
    position: source.lockTime ? source.position : next.position,
    value: next.value
  }
}

function finishDrag(commit = true): void {
  const current = drag.value
  if (!current) return
  drag.value = null
  if (commit) emit("update", current.id, current.position, current.value)
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
  renderedPoints.value.map((point) => ({
    id: point.id,
    x: positionToX(point.position),
    y: valueToY(point.value),
    label: `${props.valueLabel} ${point.value.toFixed(2)} at ${point.position.toFixed(2)} ${props.positionLabel}`,
    selected: point.id === props.selectedId,
    removable: !point.lockRemoval
  }))
)
const horizontalGuides = computed(() =>
  props.guides.map((guide) => ({ position: valueToY(guide), label: String(Math.round(guide)) }))
)
</script>

<template>
  <UiAutomationLane
    mode="value"
    :label="`${valueLabel} global track editor. Double-click to add a point.`"
    :width="contentWidth"
    :height="height"
    :color="color"
    :points="uiPoints"
    :beat-guides="beatGuides"
    :vertical-guides="verticalGuides"
    :horizontal-guides="horizontalGuides"
    :line-path="linePath"
    :fill-path="fillPath"
    @create="createPoint"
    @clear-selection="emit('select', null)"
    @point-gesture="handlePointGesture"
    @remove="emit('remove', $event)"
  />
</template>
