<script setup lang="ts">
import { computed } from "vue"
import AppWindow from "../AppWindow.vue"
import { chorusActive } from "../desk-scenario"

const props = defineProps<{ t: number }>()

interface Layer {
  kind: "project" | "set" | "patch"
  name: string
  chorus?: boolean
}

const layers: Layer[] = [
  { kind: "project", name: "Project" },
  { kind: "set", name: "Verse" },
  { kind: "patch", name: "Warm Keys" },
  { kind: "patch", name: "Lead Vox" },
  { kind: "set", name: "Chorus" },
  { kind: "patch", name: "Wide Pad", chorus: true },
  { kind: "patch", name: "Big Drums" }
]

interface Strip {
  name: string
  color: string
  verse: number
  chorus: number
  energy: number
}

const strips: Strip[] = [
  { name: "Mic", color: "var(--home-red)", verse: 0.62, chorus: 0.7, energy: 0.8 },
  { name: "Inst", color: "var(--home-green)", verse: 0.55, chorus: 0.48, energy: 0.65 },
  { name: "Keys", color: "var(--home-violet)", verse: 0.66, chorus: 0.38, energy: 0.55 },
  { name: "Pad", color: "var(--home-cyan)", verse: 0.2, chorus: 0.72, energy: 0.7 },
  { name: "Out", color: "var(--home-amber)", verse: 0.7, chorus: 0.74, energy: 0.9 }
]

const chorus = computed(() => chorusActive(props.t))
const activeName = computed(() => (chorus.value ? "Wide Pad" : "Warm Keys"))

function level(strip: Strip, index: number, channel: number): number {
  const t = props.t
  const gain = chorus.value ? strip.chorus : strip.verse
  const wobble =
    Math.sin(t * (5.1 + index) + channel * 1.3) * 0.12 + Math.sin(t * (11.7 + index * 2)) * 0.07
  return Math.max(0.04, Math.min(0.98, gain * strip.energy + wobble + 0.12))
}
</script>

<template>
  <AppWindow title="Heron Live" :basis="38">
    <template #bar><span class="live-perform">● Perform</span></template>
    <div class="live-body">
      <ul class="live-layers">
        <li
          v-for="layer in layers"
          :key="layer.name"
          class="live-layer"
          :class="[
            `live-layer--${layer.kind}`,
            { 'is-active': layer.kind === 'patch' && layer.name === activeName }
          ]"
        >
          <i class="live-layer__icon" />
          <span>{{ layer.name }}</span>
          <b v-if="layer.kind === 'patch' && layer.name === activeName" class="live-layer__badge"
            >ACTIVE</b
          >
        </li>
      </ul>
      <div class="live-mixer">
        <div v-for="(strip, i) in strips" :key="strip.name" class="live-strip">
          <span class="live-strip__name" :style="{ '--strip': strip.color }">{{ strip.name }}</span>
          <div class="live-strip__body">
            <div class="live-strip__meter">
              <i :style="{ '--level': level(strip, i, 0) }" />
              <i :style="{ '--level': level(strip, i, 1) }" />
            </div>
            <div class="live-strip__fader">
              <i
                class="live-strip__cap"
                :style="{ bottom: `${(chorus ? strip.chorus : strip.verse) * 100}%` }"
              />
            </div>
          </div>
          <span class="live-strip__toggles"><i>M</i><i>S</i></span>
        </div>
      </div>
    </div>
  </AppWindow>
</template>

<style scoped>
.live-perform {
  padding: 0.18em 0.6em;
  border-radius: 1em;
  color: #fff;
  background: var(--home-red);
  font-size: 0.68em;
  font-weight: 700;
}

.live-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.live-layers {
  width: 12.5em;
  flex: none;
  margin: 0;
  padding: 0.7em 0.55em;
  border-right: 1px solid var(--home-edge);
  list-style: none;
}

.live-layer {
  display: flex;
  height: 2em;
  align-items: center;
  gap: 0.5em;
  padding: 0 0.55em;
  border-radius: 0.45em;
  font-size: 0.82em;
  transition:
    background 250ms,
    color 250ms;
}

.live-layer--project {
  font-weight: 700;
}

.live-layer--set {
  margin-top: 0.3em;
  color: var(--home-ink-2);
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.live-layer--patch {
  padding-left: 1.3em;
}

.live-layer__icon {
  width: 0.6em;
  height: 0.6em;
  flex: none;
  border-radius: 0.15em;
  background: var(--home-ink-2);
  opacity: 0.5;
}

.live-layer--patch .live-layer__icon {
  border-radius: 50%;
}

.live-layer.is-active {
  color: var(--home-ink);
  background: color-mix(in srgb, var(--home-red) 16%, transparent);
  font-weight: 650;
}

.live-layer.is-active .live-layer__icon {
  background: var(--home-red);
  opacity: 1;
}

.live-layer__badge {
  margin-left: auto;
  color: var(--home-red);
  font-size: 0.62em;
  letter-spacing: 0.08em;
}

.live-mixer {
  display: flex;
  flex: 1;
  gap: 0.35em;
  padding: 0.7em;
}

.live-strip {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 0.45em;
  padding: 0.45em 0.2em;
  border-radius: 0.5em;
  background: var(--home-fill);
}

.live-strip__name {
  width: 100%;
  padding-bottom: 0.3em;
  border-bottom: 0.18em solid var(--strip);
  font-size: 0.66em;
  font-weight: 700;
  text-align: center;
}

.live-strip__body {
  display: flex;
  min-height: 0;
  flex: 1;
  gap: 0.35em;
}

.live-strip__meter {
  display: flex;
  align-items: flex-end;
  gap: 0.12em;
}

.live-strip__meter i {
  width: 0.3em;
  height: 100%;
  border-radius: 0.1em;
  background: linear-gradient(
    to top,
    var(--home-green) 0 65%,
    var(--home-amber) 65% 88%,
    var(--home-red) 88%
  );
  clip-path: inset(calc((1 - var(--level)) * 100%) 0 0 0 round 0.1em);
}

.live-strip__fader {
  position: relative;
  width: 0.24em;
  border-radius: 0.2em;
  background: color-mix(in srgb, var(--home-ink) 18%, transparent);
}

.live-strip__cap {
  position: absolute;
  left: 50%;
  width: 1.15em;
  height: 0.6em;
  border: 1px solid var(--home-edge);
  border-radius: 0.18em;
  background: var(--home-window-solid);
  box-shadow: 0 0.1em 0.3em var(--home-shadow-near);
  transform: translate(-50%, 50%);
  transition: bottom 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.live-strip__toggles {
  display: flex;
  gap: 0.18em;
}

.live-strip__toggles i {
  display: grid;
  width: 1.25em;
  height: 1.15em;
  place-items: center;
  border-radius: 0.25em;
  color: var(--home-ink-2);
  background: var(--home-fill);
  font-size: 0.56em;
  font-style: normal;
  font-weight: 700;
}
</style>
