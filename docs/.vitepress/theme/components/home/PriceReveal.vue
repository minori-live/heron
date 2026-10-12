<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { easeInOut } from "./home-motion"

const props = defineProps<{
  /** Starts the sequence; it plays once. */
  play: boolean
  reduced: boolean
  price: number
  currency: string
  message: string
}>()

/**
 * The price counts up, is struck through by hand, falls away, and the real
 * price takes its place. Reduced motion skips straight to the final message.
 */
type Phase = "idle" | "count" | "strike" | "drop" | "free"
const phase = ref<Phase>("idle")
const shown = ref(0)

const COUNT_MS = 700
const timeline: [Phase, number][] = [
  ["strike", COUNT_MS + 350],
  ["drop", COUNT_MS + 1350],
  ["free", COUNT_MS + 1700]
]

const timers: number[] = []
let frame = 0

function start() {
  if (props.reduced) {
    phase.value = "free"
    return
  }
  phase.value = "count"
  const began = performance.now()
  const tick = (now: number) => {
    const k = Math.min(1, (now - began) / COUNT_MS)
    shown.value = Math.round(easeInOut(k) * props.price)
    if (k < 1) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  for (const [next, at] of timeline) {
    timers.push(window.setTimeout(() => (phase.value = next), at))
  }
}

watch(
  () => props.play,
  (play) => {
    if (play && phase.value === "idle") start()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  for (const timer of timers) window.clearTimeout(timer)
})

const struck = computed(() => phase.value === "strike" || phase.value === "drop")
const priceText = computed(() => `${props.currency}${shown.value}`)
</script>

<template>
  <div class="price" :class="`price--${phase}`">
    <span class="price__sr">{{ message }}</span>
    <span class="price__stack" aria-hidden="true">
      <span class="price__tag">
        <span class="price__amount">{{ priceText }}</span>
        <svg class="price__strike" :class="{ 'is-drawn': struck }" viewBox="0 0 200 60">
          <defs>
            <filter id="price-crayon" x="-10%" y="-40%" width="120%" height="180%">
              <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="4" />
              <feDisplacementMap in="SourceGraphic" scale="3" />
            </filter>
          </defs>
          <path
            class="price__stroke"
            pathLength="1"
            d="M6 38 C 46 30, 92 33, 128 27 S 182 20, 196 22"
          />
          <path
            class="price__stroke price__stroke--second"
            pathLength="1"
            d="M14 46 C 60 38, 104 41, 140 34 S 180 30, 192 30"
          />
        </svg>
      </span>
      <span class="price__free">{{ message }}</span>
    </span>
  </div>
</template>

<style scoped>
.price {
  display: grid;
  justify-items: center;
}

.price__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.price__stack {
  display: grid;
  align-items: center;
  justify-items: center;
}

.price__tag,
.price__free {
  grid-area: 1 / 1;
}

.price__tag {
  position: relative;
  opacity: 0;
  filter: blur(8px);
  transform: translateY(12px) scale(0.92);
  transition:
    opacity 0.5s var(--home-ease),
    filter 0.5s var(--home-ease),
    transform 0.6s var(--home-ease);
}

.price--count .price__tag,
.price--strike .price__tag {
  opacity: 1;
  filter: none;
  transform: none;
}

.price--drop .price__tag {
  opacity: 0;
  filter: blur(6px);
  transform: translateY(55%) rotate(-7deg) scale(0.9);
  transition:
    opacity 0.45s ease-in,
    filter 0.45s ease-in,
    transform 0.55s cubic-bezier(0.5, 0, 0.75, 0);
}

.price--free .price__tag {
  visibility: hidden;
}

.price__amount {
  display: block;
  padding: 0 0.08em;
  color: var(--home-ink);
  font-size: clamp(64px, 11vw, 140px);
  font-variant-numeric: tabular-nums;
  font-weight: 780;
  letter-spacing: -0.05em;
  line-height: 1;
}

.price__strike {
  position: absolute;
  top: 0;
  left: -6%;
  width: 112%;
  height: 100%;
  overflow: visible;
  filter: url(#price-crayon);
}

.price__stroke {
  --delay: 0s;

  fill: none;
  stroke: var(--home-red);
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  stroke-linecap: round;
  stroke-width: 6;
  /* Round caps would otherwise paint a dot before the stroke starts drawing. */
  opacity: 0;
}

.price__stroke--second {
  --delay: 0.3s;

  stroke-width: 4.5;
}

.price__strike.is-drawn .price__stroke {
  stroke-dashoffset: 0;
  opacity: 1;
  transition:
    stroke-dashoffset 0.38s cubic-bezier(0.5, 0, 0.2, 1) var(--delay),
    opacity 0s linear var(--delay);
}

.price__strike.is-drawn .price__stroke--second {
  opacity: 0.85;
}

.price__free {
  background: linear-gradient(
    100deg,
    var(--home-cyan) 0%,
    var(--home-violet) 55%,
    var(--home-red) 100%
  );
  background-clip: text;
  color: transparent;
  font-size: clamp(44px, 7.4vw, 104px);
  font-weight: 780;
  letter-spacing: -0.045em;
  line-height: 1.02;
  text-align: center;
  text-wrap: balance;
  opacity: 0;
  filter: blur(10px);
  transform: translateY(18px) scale(0.96);
}

.price--free .price__free {
  opacity: 1;
  filter: none;
  transform: none;
  transition:
    opacity 0.6s var(--home-ease),
    filter 0.7s var(--home-ease),
    transform 0.8s cubic-bezier(0.2, 1.3, 0.4, 1);
}

@media (prefers-reduced-motion: reduce) {
  .price__tag,
  .price--free .price__free {
    transition: none;
  }
}
</style>
