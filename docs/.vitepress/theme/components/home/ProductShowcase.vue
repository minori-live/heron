<script setup lang="ts">
import { computed, ref } from "vue"
import { withBase } from "vitepress"
import SegmentedControl from "./SegmentedControl.vue"
import { REST_TIME } from "./desk-scenario"
import { useHomeCopy, type ProductKey } from "./home-copy"
import {
  smoothstep,
  useAnimationClock,
  usePrefersReducedMotion,
  useRevealOnce,
  useScrollProgress
} from "./home-motion"
import EqWindow from "./windows/EqWindow.vue"
import LiveWindow from "./windows/LiveWindow.vue"
import StudioWindow from "./windows/StudioWindow.vue"

const t = useHomeCopy()
const intro = ref<HTMLElement>()
const scroller = ref<HTMLElement>()
const reduced = usePrefersReducedMotion()
const introShown = useRevealOnce(intro)
const time = useAnimationClock(scroller, reduced, REST_TIME)
const progress = useScrollProgress(scroller, "through")

const windows = { studio: StudioWindow, live: LiveWindow, plugins: EqWindow }
const glows: Record<ProductKey, string> = {
  studio: "var(--home-cyan)",
  live: "var(--home-red)",
  plugins: "var(--home-violet)"
}

const count = computed(() => t.value.products.length)

/** Extra scroll, in viewport heights, spent resting on the first and last product. */
const EDGE_REST = 0.35

/** Scroll position mapped to a product index that rests on each product before moving on. */
const position = computed(() => {
  const span = count.value - 1
  const x = Math.min(span, Math.max(0, progress.value * (span + 2 * EDGE_REST) - EDGE_REST))
  const index = Math.min(Math.floor(x), span)
  return index + smoothstep(0.3, 0.7, x - index)
})
const active = computed(() => Math.round(position.value))
const activeKey = computed(() => t.value.products[active.value]!.key)

function cardStyle(index: number) {
  const offset = index - position.value
  const distance = Math.min(Math.abs(offset), 2)
  return {
    zIndex: 10 - Math.round(distance * 3),
    opacity: Math.max(0, 1 - distance * 0.6),
    filter: distance > 0.01 ? `blur(${distance * 5}px)` : "none",
    transform: `translateX(${offset * 64}%) scale(${1 - distance * 0.24}) rotateY(${offset * -16}deg)`
  }
}

function show(key: ProductKey) {
  const element = scroller.value
  const index = t.value.products.findIndex((product) => product.key === key)
  if (!element || index < 0) return
  const top = element.getBoundingClientRect().top + window.scrollY
  const distance = element.offsetHeight - window.innerHeight
  const span = count.value - 1
  window.scrollTo({
    top: top + (distance * (index + EDGE_REST)) / (span + 2 * EDGE_REST),
    behavior: reduced.value ? "auto" : "smooth"
  })
}
</script>

<template>
  <section id="products" class="showcase" :aria-label="t.productsAria">
    <header ref="intro" class="showcase__intro reveal" :class="{ 'is-shown': introShown }">
      <p class="home-kicker reveal-line" style="--line: 0">{{ t.productsKicker }}</p>
      <h2 class="home-heading reveal-line" style="--line: 1">{{ t.productsTitle }}</h2>
    </header>

    <div
      ref="scroller"
      class="showcase__scroller"
      :style="{ height: `${(count + 2 * EDGE_REST) * 100}svh` }"
    >
      <div class="showcase__sticky">
        <div class="showcase__stage" aria-hidden="true">
          <span class="showcase__glow" :style="{ background: glows[activeKey] }" />
          <div
            v-for="(product, i) in t.products"
            :key="product.key"
            class="showcase__card"
            :style="cardStyle(i)"
          >
            <component :is="windows[product.key]" :t="time" />
          </div>
        </div>

        <div class="showcase__text">
          <article
            v-for="(product, i) in t.products"
            :key="product.key"
            class="showcase__item reveal"
            :class="{ 'is-shown': i === active }"
            :inert="i !== active"
          >
            <p class="home-kicker reveal-line" style="--line: 0">{{ product.kicker }}</p>
            <h3 class="showcase__title reveal-line" style="--line: 1">{{ product.title }}</h3>
            <p class="showcase__body reveal-line" style="--line: 2">{{ product.body }}</p>
            <p class="showcase__links reveal-line" style="--line: 3">
              <a v-for="link in product.links" :key="link.href" :href="withBase(link.href)"
                >{{ link.label }} <span aria-hidden="true">→</span></a
              >
            </p>
          </article>
        </div>

        <SegmentedControl
          class="showcase__island"
          size="small"
          :label="t.productsAria"
          :options="t.products.map((product) => ({ value: product.key, label: product.tab }))"
          :model-value="activeKey"
          @update:model-value="show"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.showcase {
  position: relative;
}

.showcase__intro {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(96px, 14vw, 160px) 24px 0;
  text-align: center;
}

.showcase__sticky {
  position: sticky;
  top: 0;
  display: flex;
  height: 100svh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(18px, 3vh, 32px);
  padding: calc(var(--vp-nav-height) + 8px) 16px 24px;
  overflow: hidden;
}

.showcase__stage {
  position: relative;
  width: min(880px, 88vw, (100svh - 380px) * 1.6);
  aspect-ratio: 16 / 10;
  flex: none;
  perspective: 1800px;
}

.showcase__glow {
  position: absolute;
  inset: 8% 14%;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.28;
  transition: background 0.8s ease;
}

.showcase__card {
  position: absolute;
  inset: 0;
  transform-origin: 50% 60%;
  will-change: transform, opacity;
}

.showcase__text {
  display: grid;
  width: min(640px, 100%);
  text-align: center;
}

.showcase__item {
  grid-area: 1 / 1;
}

.showcase__item:not(.is-shown) {
  pointer-events: none;
}

.showcase__title {
  margin: 0 0 10px;
  font-size: clamp(26px, 3vw, 34px);
  font-weight: 750;
  letter-spacing: -0.025em;
  line-height: 1.1;
}

.showcase__body {
  margin: 0;
  color: var(--home-ink-2);
  font-size: 16px;
  line-height: 1.6;
}

.showcase__links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 20px;
  margin: 16px 0 0;
}

.showcase__links a {
  color: var(--home-ink);
  font-size: 15px;
  font-weight: 650;
  text-decoration: none;
}

.showcase__links a span {
  display: inline-block;
  color: var(--home-violet-ink);
  transition: transform 160ms ease;
}

.showcase__links a:hover span {
  transform: translateX(3px);
}

.showcase__island {
  flex: none;
  border: 1px solid var(--home-edge);
  border-radius: 999px;
  background: var(--home-panel);
  box-shadow: 0 10px 30px var(--home-shadow-near);
  backdrop-filter: blur(20px) saturate(1.4);
}

.showcase__island :deep(.segmented__indicator),
.showcase__island :deep(.segmented__option) {
  border-radius: 999px;
}

@media (max-width: 640px) {
  .showcase__stage {
    width: min(92vw, (100svh - 420px) * 1.6);
  }

  .showcase__body {
    font-size: 15px;
  }
}
</style>
