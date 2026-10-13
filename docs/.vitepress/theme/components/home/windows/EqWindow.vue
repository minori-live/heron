<script setup lang="ts">
import { computed } from "vue"
import AppWindow from "../AppWindow.vue"
import { eqCurvePath, spectrumPath, type EqBand } from "../desk-art"
import { EQ_DRAG_BAND_X, eqDragGain, eqGainToY } from "../desk-scenario"

const props = defineProps<{ t: number }>()

const frequencies = ["120 Hz", "380 Hz", "2.4 kHz", "9.6 kHz"]
const kinds = ["Bell", "Bell", "Bell", "Shelf"]

const bands = computed<EqBand[]>(() => [
  { x: 0.16, gain: -4, width: 0.05, color: "#e5d899" },
  { x: EQ_DRAG_BAND_X, gain: eqDragGain(props.t), width: 0.07, color: "#72c3c7" },
  { x: 0.62, gain: -3.5 + Math.sin(props.t * 0.6) * 0.6, width: 0.06, color: "#a98ade" },
  { x: 0.86, gain: 4, width: 0.12, color: "#ff8fa3" }
])

const curve = computed(() => eqCurvePath(bands.value))
const input = computed(() => spectrumPath(props.t, 1, true))
const output = computed(() => spectrumPath(props.t, 1, false, eqDragGain(props.t) / 40))
const gridX = [0.1, 0.33, 0.56, 0.79]
const gridY = [0.25, 0.5, 0.75]
const formatGain = (gain: number) => `${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB`
</script>

<template>
  <AppWindow title="Heron EQ" :basis="40" surface="plugin">
    <template #bar><span class="eq-mode">Natural phase</span></template>
    <div class="eq-plot">
      <svg viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
        <g class="eq-grid">
          <line v-for="x in gridX" :key="x" :x1="x * 400" :x2="x * 400" y1="0" y2="200" />
          <line v-for="y in gridY" :key="y" x1="0" x2="400" :y1="y * 200" :y2="y * 200" />
        </g>
        <path class="eq-input" :d="input" />
        <path class="eq-output" :d="output" />
        <path class="eq-curve" :d="curve" />
      </svg>
      <span
        v-for="(band, i) in bands"
        :key="i"
        class="eq-node"
        :class="{ 'is-held': i === 1 && band.gain > 3.2 }"
        :style="{
          left: `${band.x * 100}%`,
          top: `${eqGainToY(band.gain) * 100}%`,
          '--band': band.color
        }"
        >{{ i + 1 }}</span
      >
      <span class="eq-axis eq-axis--low">100</span>
      <span class="eq-axis eq-axis--mid">1k</span>
      <span class="eq-axis eq-axis--high">10k</span>
    </div>
    <div class="eq-bands">
      <div v-for="(band, i) in bands" :key="i" class="eq-band" :style="{ '--band': band.color }">
        <span class="eq-band__kind">{{ i + 1 }} · {{ kinds[i] }}</span>
        <span class="eq-band__value">{{ frequencies[i] }}</span>
        <span class="eq-band__gain">{{ formatGain(band.gain) }}</span>
      </div>
    </div>
  </AppWindow>
</template>

<style scoped>
.eq-mode {
  padding: 0.18em 0.6em;
  border-radius: 1em;
  color: #e5d899;
  background: rgb(229 216 153 / 12%);
  font-size: 0.68em;
  font-weight: 650;
}

.eq-plot {
  position: relative;
  min-height: 0;
  flex: 1;
  margin: 0.8em 0.8em 0;
  border-radius: 0.5em;
  background: #12151a;
}

.eq-plot svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.eq-grid line {
  stroke: rgb(255 255 255 / 6%);
  vector-effect: non-scaling-stroke;
}

.eq-input {
  fill: rgb(170 180 196 / 16%);
}

.eq-output {
  fill: none;
  stroke: rgb(114 195 199 / 55%);
  stroke-width: 1.2;
  vector-effect: non-scaling-stroke;
}

.eq-curve {
  fill: none;
  stroke: #e5d899;
  stroke-width: 2.4;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.eq-node {
  position: absolute;
  display: grid;
  width: 1.45em;
  height: 1.45em;
  place-items: center;
  border: 0.16em solid #12151a;
  border-radius: 50%;
  color: #12151a;
  background: var(--band);
  font-size: 0.72em;
  font-weight: 800;
  transform: translate(-50%, -50%);
  transition: box-shadow 200ms;
}

.eq-node.is-held {
  box-shadow: 0 0 0 0.45em color-mix(in srgb, var(--band) 30%, transparent);
}

.eq-axis {
  position: absolute;
  bottom: 0.4em;
  color: #6f7782;
  font-family: var(--vp-font-family-mono);
  font-size: 0.58em;
}

.eq-axis--low {
  left: 10.5%;
}

.eq-axis--mid {
  left: 56.5%;
}

.eq-axis--high {
  left: 79.5%;
}

.eq-bands {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.45em;
  padding: 0.7em 0.8em 0.8em;
}

.eq-band {
  display: grid;
  gap: 0.15em;
  padding: 0.45em 0.55em;
  border-radius: 0.45em;
  background: #1f242c;
  box-shadow: inset 0 0.16em 0 var(--band);
}

.eq-band__kind {
  color: #8d95a1;
  font-size: 0.6em;
  font-weight: 650;
}

.eq-band__value,
.eq-band__gain {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68em;
  font-variant-numeric: tabular-nums;
}

.eq-band__gain {
  color: var(--band);
}
</style>
