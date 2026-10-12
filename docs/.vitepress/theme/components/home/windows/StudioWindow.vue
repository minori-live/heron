<script setup lang="ts">
import { computed } from "vue"
import AppWindow from "../AppWindow.vue"
import { midiNotes, waveformPath } from "../desk-art"
import {
  LOOP,
  RECORD_START,
  TAKE_LENGTH,
  isRecording,
  playheadPosition,
  recordedFraction
} from "../desk-scenario"

const props = defineProps<{ t: number }>()

interface Clip {
  start: number
  end: number
  name: string
  seed: number
}

interface Track {
  name: string
  kind: "audio" | "midi" | "drums"
  color: string
  clips: Clip[]
  /** The track that receives the take recorded during the loop. */
  take?: boolean
}

const tracks: Track[] = [
  {
    name: "Lead Vox",
    kind: "audio",
    color: "var(--home-cyan)",
    take: true,
    clips: [{ start: 0.02, end: 0.3, name: "Vox · Take 3", seed: 11 }]
  },
  {
    name: "Guitar",
    kind: "audio",
    color: "var(--home-green)",
    clips: [
      { start: 0, end: 0.33, name: "Strum", seed: 23 },
      { start: 0.36, end: 0.74, name: "Strum 2", seed: 29 }
    ]
  },
  {
    name: "Keys",
    kind: "midi",
    color: "var(--home-violet)",
    clips: [
      { start: 0, end: 0.48, name: "Chords", seed: 5 },
      { start: 0.5, end: 0.98, name: "Chords", seed: 7 }
    ]
  },
  {
    name: "Drums",
    kind: "drums",
    color: "var(--home-amber)",
    clips: [{ start: 0, end: 0.98, name: "Groove", seed: 3 }]
  }
]

const waveforms = new Map(
  tracks.flatMap((track) => track.clips.map((clip) => [clip.seed, waveformPath(clip.seed)]))
)
const takeWave = waveformPath(41, 40)
const notes = new Map(
  tracks.flatMap((track) =>
    track.clips.map((clip) => [
      clip.seed,
      midiNotes(clip.seed, track.kind === "drums" ? 32 : 14, track.kind === "drums")
    ])
  )
)

const local = computed(() => props.t % LOOP)
const recording = computed(() => isRecording(props.t))
const take = computed(() => recordedFraction(props.t))
const playhead = computed(() => playheadPosition(props.t))
const timecode = computed(() => {
  const seconds = 72 + playhead.value * 64
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  const frames = Math.floor((seconds % 1) * 30)
  return `0${minutes}:${String(rest).padStart(2, "0")}:${String(frames).padStart(2, "0")}`
})
const loopStart = playheadPosition(0)
const loopRegion = {
  left: `${loopStart * 100}%`,
  width: `${(playheadPosition(LOOP - 0.001) - loopStart) * 100}%`
}
const bar = computed(() => Math.floor(playhead.value * 8) + 1)
</script>

<template>
  <AppWindow title="Heron Studio" :basis="52">
    <template #bar><span class="studio-file">night-drive.hrs</span></template>
    <div class="studio-transport">
      <span class="studio-button" aria-hidden="true"><i class="studio-stop" /></span>
      <span class="studio-button studio-button--on" aria-hidden="true"
        ><i class="studio-play"
      /></span>
      <span
        class="studio-button"
        :class="{ 'studio-button--record': recording }"
        data-cursor-target="record"
        aria-hidden="true"
        ><i class="studio-record"
      /></span>
      <span class="studio-time">{{ timecode }}</span>
      <span class="studio-meta">{{ bar }}.1.1 · 120 BPM · 4/4</span>
      <span class="studio-rate">48 kHz</span>
    </div>
    <div class="studio-arrangement">
      <div class="studio-ruler">
        <span class="studio-ruler__head" />
        <span class="studio-ruler__lane">
          <i class="studio-loop" :style="loopRegion" />
          <span v-for="n in 8" :key="n" :style="{ left: `${(n - 1) * 12.5}%` }">{{ n }}</span>
        </span>
      </div>
      <div v-for="track in tracks" :key="track.name" class="studio-track">
        <div class="studio-track__head" :style="{ '--track': track.color }">
          <span class="studio-track__name">{{ track.name }}</span>
          <span class="studio-track__toggles"><i>M</i><i>S</i></span>
        </div>
        <div class="studio-lane">
          <div
            v-for="clip in track.clips"
            :key="clip.seed"
            class="studio-clip"
            :style="{
              '--track': track.color,
              left: `${clip.start * 100}%`,
              width: `${(clip.end - clip.start) * 100}%`
            }"
          >
            <span class="studio-clip__name">{{ clip.name }}</span>
            <svg
              v-if="track.kind === 'audio'"
              class="studio-clip__art"
              viewBox="0 0 100 20"
              preserveAspectRatio="none"
            >
              <path :d="waveforms.get(clip.seed)" />
            </svg>
            <svg v-else class="studio-clip__art" viewBox="0 0 100 12" preserveAspectRatio="none">
              <rect
                v-for="(note, i) in notes.get(clip.seed)"
                :key="i"
                :x="note.x"
                :y="note.y"
                :width="note.w"
                height="1.6"
                rx="0.4"
              />
            </svg>
          </div>
          <div
            v-if="track.take && take > 0"
            class="studio-clip studio-clip--take"
            :class="{ 'is-live': recording }"
            :style="{ left: `${RECORD_START * 100}%`, width: `${take * 100}%` }"
          >
            <span class="studio-clip__name">● Take 4</span>
            <svg
              class="studio-clip__art"
              viewBox="0 0 100 20"
              preserveAspectRatio="none"
              :style="{ width: `${(TAKE_LENGTH / Math.max(take, 0.001)) * 100}%` }"
            >
              <path :d="takeWave" />
            </svg>
          </div>
        </div>
      </div>
      <div class="studio-playhead" :style="{ '--p': playhead, opacity: local < 0.2 ? 0 : 1 }" />
    </div>
  </AppWindow>
</template>

<style scoped>
.studio-file {
  padding: 0.15em 0.55em;
  border-radius: 1em;
  color: var(--home-ink-2);
  background: var(--home-fill);
  font-size: 0.72em;
}

.studio-transport {
  display: flex;
  height: 2.9em;
  flex: none;
  align-items: center;
  gap: 0.45em;
  padding: 0 0.9em;
  border-bottom: 1px solid var(--home-edge);
}

.studio-button {
  display: grid;
  width: 2em;
  height: 1.7em;
  place-items: center;
  border-radius: 0.45em;
  background: var(--home-fill);
}

.studio-button--on {
  background: color-mix(in srgb, var(--home-cyan) 22%, transparent);
}

.studio-button--record {
  background: var(--home-red);
  animation: studio-pulse 1s ease-in-out infinite alternate;
}

.studio-stop {
  width: 0.6em;
  height: 0.6em;
  border-radius: 0.1em;
  background: var(--home-ink-2);
}

.studio-play {
  width: 0;
  height: 0;
  border-top: 0.36em solid transparent;
  border-bottom: 0.36em solid transparent;
  border-left: 0.6em solid var(--home-cyan-ink);
}

.studio-record {
  width: 0.66em;
  height: 0.66em;
  border-radius: 50%;
  background: var(--home-red);
}

.studio-button--record .studio-record {
  background: #fff;
}

.studio-time {
  margin-left: 0.6em;
  font-family: var(--vp-font-family-mono);
  font-size: 1.15em;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.studio-meta,
.studio-rate {
  color: var(--home-ink-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.72em;
}

.studio-rate {
  margin-left: auto;
}

.studio-arrangement {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  --head: 7.4em;
}

.studio-ruler {
  display: flex;
  height: 1.5em;
  flex: none;
  border-bottom: 1px solid var(--home-edge);
}

.studio-ruler__head,
.studio-track__head {
  width: var(--head);
  flex: none;
  border-right: 1px solid var(--home-edge);
}

.studio-ruler__lane {
  position: relative;
  flex: 1;
}

.studio-ruler__lane span {
  position: absolute;
  top: 0.35em;
  padding-left: 0.3em;
  border-left: 1px solid var(--home-edge);
  color: var(--home-ink-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.62em;
}

.studio-loop {
  position: absolute;
  top: 0.2em;
  bottom: 0.2em;
  border-radius: 0.2em;
  background: color-mix(in srgb, var(--home-amber) 26%, transparent);
}

.studio-track {
  display: flex;
  min-height: 0;
  flex: 1;
  border-bottom: 1px solid var(--home-edge);
}

.studio-track__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.6em 0 0.75em;
  box-shadow: inset 0.22em 0 0 var(--track);
}

.studio-track__name {
  font-size: 0.78em;
  font-weight: 650;
}

.studio-track__toggles {
  display: flex;
  gap: 0.2em;
}

.studio-track__toggles i {
  display: grid;
  width: 1.3em;
  height: 1.2em;
  place-items: center;
  border-radius: 0.25em;
  color: var(--home-ink-2);
  background: var(--home-fill);
  font-size: 0.6em;
  font-style: normal;
  font-weight: 700;
}

.studio-lane {
  position: relative;
  flex: 1;
}

.studio-clip {
  position: absolute;
  top: 12%;
  bottom: 12%;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  border-radius: 0.4em;
  background: color-mix(in srgb, var(--track) 30%, var(--home-window-solid));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--track) 55%, transparent);
}

.studio-clip__name {
  padding: 0.2em 0.45em 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--track) 50%, var(--home-ink));
  font-size: 0.58em;
  font-weight: 650;
  white-space: nowrap;
}

.studio-clip__art {
  width: 100%;
  min-height: 0;
  flex: 1;
  padding: 0.1em 0.3em 0.25em;
  fill: color-mix(in srgb, var(--track) 80%, var(--home-ink));
}

.studio-clip--take {
  --track: var(--home-red);
  transition: box-shadow 200ms;
}

.studio-clip--take.is-live {
  box-shadow:
    inset 0 0 0 1px var(--home-red),
    0 0 1.2em -0.2em color-mix(in srgb, var(--home-red) 60%, transparent);
}

.studio-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--head) + (100% - var(--head)) * var(--p));
  width: 1.5px;
  background: var(--home-ink);
  pointer-events: none;
}

.studio-playhead::before {
  position: absolute;
  top: 0;
  left: -0.4em;
  border-top: 0.55em solid var(--home-ink);
  border-right: 0.4em solid transparent;
  border-left: 0.4em solid transparent;
  content: "";
}

@keyframes studio-pulse {
  to {
    box-shadow: 0 0 0 0.3em color-mix(in srgb, var(--home-red) 25%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .studio-button--record {
    animation: none;
  }
}
</style>
