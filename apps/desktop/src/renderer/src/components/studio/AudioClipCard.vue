<script setup lang="ts">
import { computed, watch } from "vue"
import { useI18n } from "vue-i18n"
import { UiContextMenu, UiTimelineClip, type UiGestureIntent, type UiMenuEntry } from "@heron/ui"
import type { AudioClipState, TempoMapSnapshot, WaveformDisplayMode } from "@heron/contracts"
import type { TimelineClip } from "../../stores/transport"
import { useClipWaveform } from "../../composables/useClipWaveform"
import {
  createEqualPowerFadeCurvePath,
  createEqualPowerFadeShadePath
} from "../../utils/audioFadeCurve"
import { secondsToTimelineX } from "../../utils/timelineCoordinates"
import { secondsToTick, tempoAtTick } from "../../utils/tempoMap"
import {
  projectFrameToAssetFrame,
  type AudioFadeEdge,
  type ClipTrimEdge
} from "../../utils/clipEditing"
import ChannelFormatIcon from "./ChannelFormatIcon.vue"
import WaveformCanvas from "./WaveformCanvas.vue"
import { useAudioClipEdit } from "./useAudioClipEdit"

const { t } = useI18n()

const props = defineProps<{
  clip: TimelineClip
  tempoMap: TempoMapSnapshot
  pixelsPerQuarter: number
  viewportStartSeconds: number
  viewportEndSeconds: number
  amplitudeScale: number
  displayMode: WaveformDisplayMode
  selected: boolean
  trackColor: string
  recording?: boolean
  dragging?: boolean
  playheadFrame: number
  splitShortcut?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  waveformFrameCount: [frameCount: number, sampleRate: number]
  dragStart: [clipId: string, offsetPixels: number]
  dragEnd: []
  remove: [clipId: string]
  split: [clipId: string]
  trim: [clipId: string, edge: ClipTrimEdge, frame: number]
  fade: [clipId: string, edge: AudioFadeEdge, frames: number]
  resetFades: [clipId: string]
}>()

const clipState = computed<AudioClipState>(() => ({
  id: props.clip.id,
  assetId: props.clip.assetId,
  trackId: props.clip.trackId,
  name: props.clip.name,
  startFrame: props.clip.startFrame,
  sourceOffsetFrames: props.clip.sourceOffsetFrames,
  lengthFrames: props.clip.lengthFrames,
  sourceLengthFrames: props.clip.sourceLengthFrames,
  fadeInFrames: props.clip.fadeInFrames,
  fadeOutFrames: props.clip.fadeOutFrames,
  assetSampleRate: props.clip.sampleRate,
  assetChannels: props.clip.channels
}))
const { active, preview, handleGesture } = useAudioClipEdit({
  clip: clipState,
  tempoMap: () => props.tempoMap,
  pixelsPerQuarter: () => props.pixelsPerQuarter,
  projectSampleRate: () => props.clip.projectSampleRate,
  commitTrim: (edge, frame) => emit("trim", props.clip.id, edge, frame),
  commitFade: (edge, frames) => emit("fade", props.clip.id, edge, frames)
})
const displayedClip = computed(() => preview.value ?? clipState.value)
const displayedStartSeconds = computed(
  () => displayedClip.value.startFrame / props.clip.projectSampleRate
)
const displayedEndSeconds = computed(
  () =>
    (displayedClip.value.startFrame + displayedClip.value.lengthFrames) /
    props.clip.projectSampleRate
)
const clipStartX = computed(() =>
  secondsToTimelineX(props.tempoMap, displayedStartSeconds.value, props.pixelsPerQuarter)
)
const clipEndX = computed(() =>
  secondsToTimelineX(props.tempoMap, displayedEndSeconds.value, props.pixelsPerQuarter)
)
const visibleStartSeconds = computed(() =>
  Math.max(displayedStartSeconds.value, props.viewportStartSeconds)
)
const visibleEndSeconds = computed(() =>
  Math.min(displayedEndSeconds.value, props.viewportEndSeconds)
)
const visibleWidth = computed(() =>
  Math.max(
    1,
    secondsToTimelineX(props.tempoMap, visibleEndSeconds.value, props.pixelsPerQuarter) -
      secondsToTimelineX(props.tempoMap, visibleStartSeconds.value, props.pixelsPerQuarter)
  )
)
const waveformTimelineStartX = computed(() =>
  secondsToTimelineX(props.tempoMap, visibleStartSeconds.value, props.pixelsPerQuarter)
)
const waveformSourceResolution = computed(() => {
  const startTick = secondsToTick(props.tempoMap, visibleStartSeconds.value)
  const endTick = secondsToTick(props.tempoMap, visibleEndSeconds.value)
  const maximumTempo = Math.max(
    tempoAtTick(props.tempoMap, startTick),
    ...props.tempoMap.tempoEvents
      .filter((event) => event.tick > startTick && event.tick < endTick)
      .map((event) => event.beatsPerMinute)
  )
  return Math.max(
    visibleWidth.value,
    ((Math.max(0, visibleEndSeconds.value - visibleStartSeconds.value) * maximumTempo) / 60) *
      props.pixelsPerQuarter
  )
})
const waveformStyle = computed(() => ({
  left: `${
    secondsToTimelineX(props.tempoMap, visibleStartSeconds.value, props.pixelsPerQuarter) -
    clipStartX.value
  }px`,
  width: `${visibleWidth.value}px`
}))
const startFrame = computed(() =>
  projectFrameToAssetFrame(
    displayedClip.value.sourceOffsetFrames +
      (visibleStartSeconds.value - displayedStartSeconds.value) * props.clip.projectSampleRate,
    props.clip.projectSampleRate,
    props.clip.sampleRate
  )
)
const endFrame = computed(() =>
  props.recording
    ? Number.MAX_SAFE_INTEGER
    : Math.max(
        startFrame.value,
        projectFrameToAssetFrame(
          displayedClip.value.sourceOffsetFrames +
            (visibleEndSeconds.value - displayedStartSeconds.value) * props.clip.projectSampleRate,
          props.clip.projectSampleRate,
          props.clip.sampleRate,
          "ceil"
        )
      )
)
const { data: waveformData, loading: waveformLoading } = useClipWaveform({
  id: () => props.clip.assetId,
  recording: () => Boolean(props.recording),
  startFrame,
  endFrame,
  pixelWidth: waveformSourceResolution
})
const canEditAtPlayhead = computed(
  () =>
    props.playheadFrame > props.clip.startFrame &&
    props.playheadFrame < props.clip.startFrame + props.clip.lengthFrames
)
const menuEntries = computed<readonly UiMenuEntry[]>(() => [
  {
    kind: "item",
    id: "split",
    label: t("studio.arrangement.splitAtPlayhead"),
    shortcut: props.splitShortcut,
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
  {
    kind: "item",
    id: "reset-fades",
    label: t("studio.arrangement.resetFades"),
    disabled: props.clip.fadeInFrames === 0 && props.clip.fadeOutFrames === 0
  },
  { kind: "separator", id: "delete-separator" },
  { kind: "item", id: "delete", label: t("studio.arrangement.deleteClip"), tone: "danger" }
])
const fadeInStyle = computed(() => ({
  width: `${(displayedClip.value.fadeInFrames / displayedClip.value.lengthFrames) * 100}%`
}))
const fadeOutStyle = computed(() => ({
  width: `${(displayedClip.value.fadeOutFrames / displayedClip.value.lengthFrames) * 100}%`
}))
const fadeInCurvePath = createEqualPowerFadeCurvePath("in")
const fadeOutCurvePath = createEqualPowerFadeCurvePath("out")
const fadeInShadePath = createEqualPowerFadeShadePath("in")
const fadeOutShadePath = createEqualPowerFadeShadePath("out")

watch(
  () => waveformData.value?.frameCount,
  (frameCount) => {
    if (props.recording && frameCount !== undefined && waveformData.value) {
      emit("waveformFrameCount", frameCount, waveformData.value.sampleRate)
    }
  }
)

function selectMenuAction(id: string): void {
  if (id === "split") emit("split", props.clip.id)
  else if (id === "trim-start") emit("trim", props.clip.id, "start", props.playheadFrame)
  else if (id === "trim-end") emit("trim", props.clip.id, "end", props.playheadFrame)
  else if (id === "reset-fades") emit("resetFades", props.clip.id)
  else if (id === "delete") emit("remove", props.clip.id)
}

function editGesture(action: string, intent: UiGestureIntent): void {
  if (action === "trim-start") handleGesture("trim", "start", intent)
  else if (action === "trim-end") handleGesture("trim", "end", intent)
  else if (action === "fade-in") handleGesture("fade", "in", intent)
  else handleGesture("fade", "out", intent)
}
</script>

<template>
  <UiContextMenu
    :entries="menuEntries"
    :menu-label="t('studio.arrangement.audioClipMenu', { name: clip.name })"
    @open-context="!selected && emit('select', clip.id)"
    @select="selectMenuAction"
  >
    <UiTimelineClip
      class="audio-clip"
      kind="audio"
      :model="{
        id: clip.id,
        label: clip.name,
        start: clipStartX,
        width: Math.max(12, clipEndX - clipStartX),
        selected,
        signalColor: trackColor
      }"
      :label="`${recording ? 'Recording' : 'Audio clip'} ${clip.name}`"
      :recording="recording"
      :dragging="dragging"
      :editing="active"
      :drag-data="[{ mime: 'application/x-heron-clip', value: clip.id }]"
      :trim-start-label="t('studio.arrangement.trimClipStart', { name: clip.name })"
      :trim-end-label="t('studio.arrangement.trimClipEnd', { name: clip.name })"
      :fade-in-label="t('studio.arrangement.fadeIn', { name: clip.name })"
      :fade-out-label="t('studio.arrangement.fadeOut', { name: clip.name })"
      :fade-in-percent="(displayedClip.fadeInFrames / displayedClip.lengthFrames) * 100"
      :fade-out-percent="(displayedClip.fadeOutFrames / displayedClip.lengthFrames) * 100"
      :fade-in-value="displayedClip.fadeInFrames"
      :fade-in-maximum="Math.max(0, displayedClip.lengthFrames - displayedClip.fadeOutFrames)"
      :fade-out-value="displayedClip.fadeOutFrames"
      :fade-out-maximum="Math.max(0, displayedClip.lengthFrames - displayedClip.fadeInFrames)"
      @select="emit('select', clip.id)"
      @remove="emit('remove', clip.id)"
      @drag-start="emit('dragStart', clip.id, $event)"
      @drag-end="emit('dragEnd')"
      @gesture="editGesture"
    >
      <template #overlay>
        <svg
          class="fade-region fade-region-in"
          :style="fadeInStyle"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path class="fade-shade" :d="fadeInShadePath" />
          <path class="fade-curve" :d="fadeInCurvePath" />
        </svg>
        <svg
          class="fade-region fade-region-out"
          :style="fadeOutStyle"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path class="fade-shade" :d="fadeOutShadePath" />
          <path class="fade-curve" :d="fadeOutCurvePath" />
        </svg>
      </template>
      <template #heading
        ><span class="clip-heading" :title="clip.name">
          <b class="clip-name">{{ clip.name }}</b>
          <span
            v-if="recording"
            class="capture-dot"
            :aria-label="t('studio.arrangement.recordingAria')"
          />
          <ChannelFormatIcon :channels="clip.channels" /> </span
      ></template>
      <span v-if="visibleEndSeconds > visibleStartSeconds" class="waveform" :style="waveformStyle">
        <WaveformCanvas
          :window="waveformData"
          :display-mode="displayMode"
          :amplitude-scale="amplitudeScale"
          :loading="waveformLoading"
          :recording="recording"
          :tempo-map="tempoMap"
          :pixels-per-quarter="pixelsPerQuarter"
          :timeline-start-x="waveformTimelineStartX"
          :clip-start-seconds="displayedStartSeconds"
        />
      </span>
    </UiTimelineClip>
  </UiContextMenu>
</template>

<style scoped>
.clip-heading {
  display: contents;
}
.clip-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: var(--ui-type-size-body-compact);
  font-weight: var(--ui-type-weight-semibold);
  line-height: var(--ui-type-leading-normal);
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px var(--ui-domain-color-000a);
}
.channel-format {
  color: var(--ui-domain-color-f0f4f5);
  filter: drop-shadow(0 1px 1px var(--ui-domain-color-0008));
}
.recording .channel-format {
  color: var(--ui-domain-color-ffe0e4);
}
.capture-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border: 1px solid var(--ui-domain-color-ffe5e9);
  border-radius: 50%;
  background: var(--record);
  box-shadow: 0 0 5px var(--record);
}
.waveform {
  position: absolute;
  z-index: var(--ui-z-local-content);
  top: 22px;
  right: 0;
  bottom: 3px;
  overflow: hidden;
  opacity: 0.94;
}
.fade-region {
  position: absolute;
  z-index: calc(var(--ui-z-local-selection) + 1);
  top: 0;
  bottom: 0;
  height: 100%;
  pointer-events: none;
}
.fade-region-in {
  left: 0;
}
.fade-region-out {
  right: 0;
}
.fade-shade {
  fill: var(--ui-domain-color-0008);
}
.fade-curve {
  fill: none;
  stroke: var(--ui-domain-color-fff);
  stroke-width: 1.25px;
  vector-effect: non-scaling-stroke;
}
</style>
