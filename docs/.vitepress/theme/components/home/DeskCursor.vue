<script setup lang="ts">
defineProps<{
  x: number
  y: number
  color: string
  label: string
  labelVisible: boolean
  pressed: number
}>()
</script>

<template>
  <div class="desk-cursor" :style="{ left: `${x}%`, top: `${y}%`, '--cursor': color }">
    <span
      v-if="pressed > 0"
      class="desk-cursor__ripple"
      :style="{
        opacity: pressed,
        transform: `translate(-50%, -50%) scale(${2.4 - pressed * 1.4})`
      }"
    />
    <svg
      class="desk-cursor__arrow"
      viewBox="0 0 32 32"
      :style="{ transform: `scale(${1 - pressed * 0.16})` }"
      aria-hidden="true"
    >
      <path d="M4 3 L28 15.5 L16.5 18 L11 29 Z" />
    </svg>
    <span class="desk-cursor__label" :class="{ 'is-visible': labelVisible }">{{ label }}</span>
  </div>
</template>

<style scoped>
.desk-cursor {
  position: absolute;
  z-index: 10;
  width: 0;
  height: 0;
  pointer-events: none;
}

.desk-cursor__arrow {
  position: absolute;
  top: -0.25em;
  left: -0.25em;
  width: 2.6em;
  height: 2.6em;
  overflow: visible;
  filter: drop-shadow(0 0.3em 0.5em rgb(16 18 28 / 28%));
  transform-origin: 0.25em 0.25em;
}

.desk-cursor__arrow path {
  fill: var(--cursor);
  stroke: #fff;
  stroke-linejoin: round;
  stroke-width: 2.4;
}

.desk-cursor__ripple {
  position: absolute;
  width: 3.2em;
  height: 3.2em;
  border: 0.18em solid var(--cursor);
  border-radius: 50%;
}

.desk-cursor__label {
  position: absolute;
  top: 2.1em;
  left: 1.7em;
  padding: 0.38em 0.85em;
  border: 1px solid rgb(255 255 255 / 55%);
  border-radius: 1em;
  color: #10131a;
  background: var(--cursor);
  box-shadow: 0 0.4em 1em -0.3em color-mix(in srgb, var(--cursor) 70%, transparent);
  font-size: 1.05em;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(0.4em) scale(0.85);
  transform-origin: 0 0;
  transition:
    opacity 220ms ease,
    transform 420ms cubic-bezier(0.2, 1.4, 0.4, 1);
}

.desk-cursor__label.is-visible {
  opacity: 1;
  transform: none;
}
</style>
