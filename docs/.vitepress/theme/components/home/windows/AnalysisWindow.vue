<script setup lang="ts">
import { computed } from "vue"
import AppWindow from "../AppWindow.vue"
import { analysisSweep } from "../desk-scenario"

const props = defineProps<{ t: number }>()

const tabs = ["Response", "Phase", "Harmonics", "Performance"]

/** Measured gain in dB at a normalized log-frequency position. */
const response = (x: number) =>
  -14 * (1 - Math.min(1, x / 0.1)) ** 2 +
  3.2 * Math.exp(-(((x - 0.38) / 0.09) ** 2)) -
  2.4 * Math.exp(-(((x - 0.7) / 0.07) ** 2)) -
  9 * Math.max(0, x - 0.9) * 10 * Math.max(0, x - 0.9)
const reference = (x: number) => -10 * (1 - Math.min(1, x / 0.08)) ** 2

const toY = (gain: number) => 70 - gain * 7
function plot(fn: (x: number) => number): string {
  const parts: string[] = []
  for (let i = 0; i <= 100; i++) {
    parts.push(`${i * 4} ${toY(fn(i / 100)).toFixed(1)}`)
  }
  return `M${parts.join(" L")}`
}

const measured = plot(response)
const compared = plot(reference)
const harmonics = [0.82, 0.46, 0.3, 0.18, 0.1]

const sweep = computed(() => analysisSweep(props.t))
const readout = computed(() => {
  const x = sweep.value
  const hz = 20 * 1000 ** x
  const label = hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`
  const gain = response(x)
  return { label, gain: `${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB`, y: toY(gain) / 160 }
})
</script>

<template>
  <AppWindow title="Plugin Analysis" :basis="40" surface="plugin">
    <div class="analysis-tabs">
      <span v-for="(tab, i) in tabs" :key="tab" :class="{ 'is-active': i === 0 }">{{ tab }}</span>
    </div>
    <div class="analysis-body">
      <div class="analysis-plot">
        <svg viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true">
          <g class="analysis-grid">
            <line v-for="x in [100, 200, 300]" :key="x" :x1="x" :x2="x" y1="0" y2="160" />
            <line v-for="y in [40, 80, 120]" :key="y" x1="0" x2="400" :y1="y" :y2="y" />
          </g>
          <path class="analysis-compare" :d="compared" />
          <path class="analysis-measured" :d="measured" />
        </svg>
        <template v-if="sweep >= 0">
          <span class="analysis-sweep" :style="{ left: `${sweep * 100}%` }" />
          <span
            class="analysis-dot"
            :style="{ left: `${sweep * 100}%`, top: `${readout.y * 100}%` }"
          />
          <span
            class="analysis-readout"
            :style="{ left: `${Math.min(sweep, 0.72) * 100}%`, top: `${readout.y * 100}%` }"
            >{{ readout.label }} · {{ readout.gain }}</span
          >
        </template>
      </div>
      <div class="analysis-side">
        <span class="analysis-side__label">THD</span>
        <strong class="analysis-side__value">0.012%</strong>
        <div class="analysis-harmonics">
          <i v-for="(h, i) in harmonics" :key="i" :style="{ height: `${h * 100}%` }" />
        </div>
        <span class="analysis-side__label">H2 – H6</span>
      </div>
    </div>
  </AppWindow>
</template>

<style scoped>
.analysis-tabs {
  display: flex;
  gap: 0.3em;
  padding: 0.6em 0.8em 0;
}

.analysis-tabs span {
  padding: 0.3em 0.7em;
  border-radius: 0.45em;
  color: #8d95a1;
  font-size: 0.7em;
  font-weight: 650;
}

.analysis-tabs .is-active {
  color: #e9ecef;
  background: #262b34;
}

.analysis-body {
  display: flex;
  min-height: 0;
  flex: 1;
  gap: 0.6em;
  padding: 0.6em 0.8em 0.8em;
}

.analysis-plot {
  position: relative;
  flex: 1;
  border-radius: 0.5em;
  background: #12151a;
}

.analysis-plot svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.analysis-grid line {
  stroke: rgb(255 255 255 / 6%);
  vector-effect: non-scaling-stroke;
}

.analysis-measured {
  fill: none;
  stroke: #72c3c7;
  stroke-width: 2.2;
  vector-effect: non-scaling-stroke;
}

.analysis-compare {
  fill: none;
  stroke: #a98ade;
  stroke-dasharray: 5 4;
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}

.analysis-sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgb(229 216 153 / 50%);
}

.analysis-dot {
  position: absolute;
  width: 0.7em;
  height: 0.7em;
  border: 0.14em solid #12151a;
  border-radius: 50%;
  background: #e5d899;
  transform: translate(-50%, -50%);
}

.analysis-readout {
  position: absolute;
  margin: -2.4em 0 0 0.7em;
  padding: 0.25em 0.5em;
  border-radius: 0.35em;
  color: #12151a;
  background: #e5d899;
  font-family: var(--vp-font-family-mono);
  font-size: 0.62em;
  font-weight: 650;
  white-space: nowrap;
}

.analysis-side {
  display: flex;
  width: 7.5em;
  flex-direction: column;
  gap: 0.3em;
  padding: 0.6em;
  border-radius: 0.5em;
  background: #1f242c;
}

.analysis-side__label {
  color: #8d95a1;
  font-size: 0.6em;
  font-weight: 650;
}

.analysis-side__value {
  font-family: var(--vp-font-family-mono);
  font-size: 0.95em;
}

.analysis-harmonics {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: flex-end;
  gap: 0.25em;
  margin-top: 0.3em;
}

.analysis-harmonics i {
  flex: 1;
  border-radius: 0.15em 0.15em 0 0;
  background: linear-gradient(to top, #a98ade, #ff8fa3);
}
</style>
