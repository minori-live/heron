<script setup lang="ts">
import { ref } from "vue"
import { useHomeCopy } from "./home-copy"
import { usePrefersReducedMotion, useRevealOnce } from "./home-motion"
import PriceReveal from "./PriceReveal.vue"

const t = useHomeCopy()
const root = ref<HTMLElement>()
const shown = useRevealOnce(root, 0.2)
const price = ref<HTMLElement>()
// Wait until the price is well inside the viewport so the reader sees it struck.
const pricePlaying = useRevealOnce(price, 0.9)
const reduced = usePrefersReducedMotion()

const accents = ["var(--home-cyan)", "var(--home-violet)", "var(--home-red)", "var(--home-amber)"]
const icons = [
  // An open padlock.
  "M7 11V8a5 5 0 0 1 9.6-2 M5 11h14v9H5z M12 15v2",
  // Three stacked desktops.
  "M3 5h18v11H3z M8 20h8 M12 16v4",
  // A project archive.
  "M4 7h16v13H4z M3 4h18v3H3z M10 11h4",
  // A branching history.
  "M6 4v16 M6 9a6 6 0 0 0 6 6h2 M18 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0z M8 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"
]
</script>

<template>
  <section ref="root" class="values reveal" :class="{ 'is-shown': shown }">
    <header class="values__intro">
      <p class="home-kicker reveal-line" style="--line: 0">{{ t.valuesKicker }}</p>
      <h2 ref="price" class="values__price">
        <PriceReveal
          :play="pricePlaying"
          :reduced="reduced"
          :price="999"
          currency="$"
          :message="t.valuesPrice"
        />
      </h2>
      <p class="values__subtitle reveal-line" style="--line: 1">{{ t.valuesTitle }}</p>
    </header>
    <ul class="values__grid">
      <li
        v-for="(value, i) in t.values"
        :key="value.title"
        class="values__card reveal-line"
        :style="{ '--line': i + 2, '--accent': accents[i] }"
      >
        <svg class="values__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="icons[i]" />
        </svg>
        <h3>{{ value.title }}</h3>
        <p>{{ value.body }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.values {
  width: min(1120px, calc(100% - 48px));
  margin: 0 auto;
  padding: clamp(96px, 12vw, 150px) 0 40px;
}

.values__intro {
  max-width: 1040px;
  margin: 0 auto 48px;
  text-align: center;
}

.values__price {
  margin: 0 0 18px;
}

.values__subtitle {
  margin: 0;
  color: var(--home-ink-2);
  font-size: clamp(19px, 2vw, 24px);
  font-weight: 600;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.values__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.values__card {
  padding: 24px 22px 26px;
  border: 1px solid var(--home-edge);
  border-radius: 22px;
  background: var(--home-panel);
  backdrop-filter: blur(18px);
}

.values__icon {
  width: 40px;
  height: 40px;
  margin-bottom: 18px;
  padding: 9px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  fill: none;
  stroke: color-mix(in srgb, var(--accent) 75%, var(--home-ink));
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.values__card h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.values__card p {
  margin: 0;
  color: var(--home-ink-2);
  font-size: 14.5px;
  line-height: 1.55;
}

@media (max-width: 960px) {
  .values__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .values {
    width: calc(100% - 32px);
  }

  .values__grid {
    grid-template-columns: 1fr;
  }
}
</style>
