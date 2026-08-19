<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiTimelineRuler, type UiGestureIntent, type UiTimelineRegion } from "@heron/ui"
import {
  DEFAULT_PROJECT_END_TICK,
  type TempoMapSnapshot,
  type TransportLoopRange
} from "@heron/contracts"
import {
  barLengthTicksAtTick,
  barTicksThroughTick,
  beatTicksThroughTick
} from "../../utils/tempoMap"
import { timelineXToSeconds, tickToTimelineX } from "../../utils/timelineCoordinates"
import { useCycleRangeDrag } from "./useCycleRangeDrag"
import { useProjectEndDrag } from "./useProjectEndDrag"

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    contentWidth: number
    pixelsPerQuarter: number
    tempoMap: TempoMapSnapshot
    loopEnabled?: boolean
    loopRange?: TransportLoopRange | null
    cycleDisabled?: boolean
    projectEndTick?: number
  }>(),
  {
    loopEnabled: false,
    loopRange: null,
    cycleDisabled: false,
    projectEndTick: DEFAULT_PROJECT_END_TICK
  }
)
const emit = defineEmits<{
  seek: [seconds: number]
  updateLoopRange: [range: TransportLoopRange]
  updateProjectEnd: [endTick: number]
}>()
const marks = computed(() =>
  barTicksThroughTick(
    props.tempoMap,
    (props.contentWidth / props.pixelsPerQuarter) * props.tempoMap.ticksPerQuarter
  ).map((tick, index) => ({
    id: `bar-${tick}`,
    label: String(index + 1).padStart(2, "0"),
    position: (tick / props.tempoMap.ticksPerQuarter) * props.pixelsPerQuarter
  }))
)
const beatMarks = computed(() =>
  beatTicksThroughTick(
    props.tempoMap,
    (props.contentWidth / props.pixelsPerQuarter) * props.tempoMap.ticksPerQuarter
  ).map((tick) => ({
    id: `beat-${tick}`,
    position: (tick / props.tempoMap.ticksPerQuarter) * props.pixelsPerQuarter
  }))
)
const { preview, start, update, finish, cancel } = useCycleRangeDrag({
  range: () => props.loopRange,
  tempoMap: () => props.tempoMap,
  pixelsPerQuarter: () => props.pixelsPerQuarter,
  commit: (range) => emit("updateLoopRange", range)
})
const displayedRange = computed(() => preview.value ?? props.loopRange)
const cycleRegion = computed<UiTimelineRegion | null>(() => {
  const range = displayedRange.value
  if (!range) return null
  const left = tickToTimelineX(props.tempoMap, range.startTick, props.pixelsPerQuarter)
  const right = tickToTimelineX(props.tempoMap, range.endTick, props.pixelsPerQuarter)
  return { start: left, end: right }
})
const projectEndDrag = useProjectEndDrag({
  endTick: () => props.projectEndTick,
  tempoMap: () => props.tempoMap,
  pixelsPerQuarter: () => props.pixelsPerQuarter,
  commit: (endTick) => emit("updateProjectEnd", endTick)
})
const displayedProjectEndTick = computed(() => projectEndDrag.preview.value ?? props.projectEndTick)
const projectEndLeft = computed(() =>
  tickToTimelineX(props.tempoMap, displayedProjectEndTick.value, props.pixelsPerQuarter)
)
function seekAt(position: number): void {
  emit("seek", timelineXToSeconds(props.tempoMap, position, props.pixelsPerQuarter))
}

function handleCycleGesture(mode: Parameters<typeof start>[1], intent: UiGestureIntent): void {
  if (props.cycleDisabled) return
  if (intent.phase === "start") start(intent, mode)
  else if (intent.phase === "update") update(intent)
  else if (intent.phase === "commit") finish()
  else cancel()
}

function handleProjectEndGesture(intent: UiGestureIntent): void {
  if (intent.phase === "start") projectEndDrag.start(intent)
  else if (intent.phase === "update") projectEndDrag.update(intent)
  else if (intent.phase === "commit") projectEndDrag.finish()
  else projectEndDrag.cancel()
}

function moveProjectEndFromKeyboard(direction: -1 | 1): void {
  const boundaries = barTicksThroughTick(
    props.tempoMap,
    props.projectEndTick + barLengthTicksAtTick(props.tempoMap, props.projectEndTick) * 2
  ).filter((tick) => tick > 0)
  const currentIndex = boundaries.findIndex((tick) => tick >= props.projectEndTick)
  const targetIndex = Math.max(0, currentIndex + direction)
  const endTick = boundaries[targetIndex]
  if (endTick !== undefined && endTick !== props.projectEndTick) emit("updateProjectEnd", endTick)
}
</script>

<template>
  <UiTimelineRuler
    :width="contentWidth"
    :label="t('studio.arrangement.timelineRulerAria')"
    :marks="marks"
    :beat-marks="beatMarks"
    :cycle-label="t('studio.arrangement.cycleLaneAria')"
    :cycle-region="cycleRegion"
    :cycle-enabled="loopEnabled"
    :cycle-disabled="cycleDisabled"
    :project-end="projectEndLeft"
    :project-end-label="t('studio.arrangement.projectEndAria')"
    :project-end-title="t('studio.arrangement.projectEndTooltip')"
    @seek="seekAt"
    @cycle-gesture="handleCycleGesture"
    @project-end-gesture="handleProjectEndGesture"
    @project-end-step="moveProjectEndFromKeyboard"
  />
</template>
