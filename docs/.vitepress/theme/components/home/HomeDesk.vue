<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { REST_TIME, deskWindows, type Rect } from "./desk-scenario"
import { useHomeCopy } from "./home-copy"
import { useAnimationClock, usePrefersReducedMotion, useScrollProgress } from "./home-motion"
import AnalysisWindow from "./windows/AnalysisWindow.vue"
import EqWindow from "./windows/EqWindow.vue"
import LiveWindow from "./windows/LiveWindow.vue"
import StudioWindow from "./windows/StudioWindow.vue"

const t = useHomeCopy()
const hero = ref<HTMLElement>()
const reduced = usePrefersReducedMotion()
const time = useAnimationClock(hero, reduced, REST_TIME)
const leave = useScrollProgress(hero, "leave")
const assembled = ref(false)

const windows = [
  { key: "eq", component: EqWindow, rect: deskWindows.eq },
  { key: "analysis", component: AnalysisWindow, rect: deskWindows.analysis },
  { key: "studio", component: StudioWindow, rect: deskWindows.studio },
  { key: "live", component: LiveWindow, rect: deskWindows.live }
] as const

/** Each window starts in a tilted diagonal stack and flies to its place. */
function slotStyle(rect: Rect, index: number) {
  const offset = index - (windows.length - 1) / 2
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.w}%`,
    height: `${rect.h}%`,
    "--i": index,
    "--from-x": `${50 - (rect.x + rect.w / 2) + offset * 12}cqw`,
    "--from-y": `${(50 - (rect.y + rect.h / 2) + offset * 10) * 0.54}cqw`
  }
}

const stageStyle = computed(() => {
  const p = leave.value
  if (p <= 0.001) return {}
  return {
    opacity: 1 - p * 0.75,
    filter: `blur(${p * 10}px)`,
    transform: `translateY(${p * 8}%) scale(${1 - p * 0.08})`
  }
})

onMounted(() => {
  requestAnimationFrame(() => {
    assembled.value = true
  })
})
</script>

<template>
  <section ref="hero" class="desk" :class="{ 'is-assembled': assembled, 'is-reduced': reduced }">
    <div class="desk__viewport">
      <div class="desk__stage" role="img" :aria-label="t.deskLabel" :style="stageStyle">
        <div
          v-for="(win, i) in windows"
          :key="win.key"
          class="desk__slot"
          :style="slotStyle(win.rect, i)"
        >
          <div class="desk__motion">
            <div class="desk__float">
              <component :is="win.component" :t="time" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="desk__copy reveal" :class="{ 'is-shown': assembled }">
      <p class="desk__eyebrow reveal-line" style="--line: 0">{{ t.heroEyebrow }}</p>
      <h1 class="desk__title reveal-line" style="--line: 1">{{ t.heroTitle }}</h1>
      <p class="desk__lead reveal-line" style="--line: 2">{{ t.heroLead }}</p>
      <div class="desk__actions reveal-line" style="--line: 3">
        <a class="home-button home-button--solid" href="#get-heron">{{ t.heroPrimary }}</a>
        <a class="home-button" href="#products">{{ t.heroSecondary }}</a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.desk {
  position: relative;
  padding-top: var(--vp-nav-height);
  overflow: clip;
}

.desk__viewport {
  position: relative;
  /* Keep the headline and actions above the fold: the desk takes what the copy leaves. */
  width: max(640px, min(100%, (100svh - var(--vp-nav-height) - 340px) * 1440 / 780));
  max-width: 1480px;
  left: 50%;
  transform: translateX(-50%);
}

.desk__stage {
  position: relative;
  container-type: inline-size;
  aspect-ratio: 1440 / 780;
  font-size: 0.78cqw;
  perspective: 2400px;
  transform-origin: 50% 30%;
  will-change: transform;
}

.desk__slot {
  position: absolute;
}

.desk__motion {
  width: 100%;
  height: 100%;
  opacity: 0;
  filter: blur(14px);
  transform: translate3d(var(--from-x), var(--from-y), 0) rotateX(54deg) rotateZ(-36deg) scale(0.5);
  transition:
    transform 1.4s cubic-bezier(0.2, 1, 0.3, 1) calc(var(--i) * 90ms + 120ms),
    filter 1s ease calc(var(--i) * 90ms + 260ms),
    opacity 0.5s ease calc(var(--i) * 90ms);
}

.is-assembled .desk__motion {
  opacity: 1;
  filter: none;
  transform: none;
}

.desk__float {
  width: 100%;
  height: 100%;
  animation: desk-float 7s ease-in-out calc(var(--i) * -1.7s) infinite alternate;
}

.desk__copy {
  position: relative;
  z-index: 2;
  max-width: 820px;
  margin: -12px auto 0;
  padding: 0 24px;
  text-align: center;
}

.desk__eyebrow {
  margin: 0 0 14px;
  color: var(--home-violet-ink);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.desk__title {
  margin: 0 0 14px;
  color: var(--home-ink);
  font-size: clamp(40px, 5.4vw, 64px);
  font-weight: 760;
  letter-spacing: -0.035em;
  line-height: 1.04;
  text-wrap: balance;
}

.desk__lead {
  max-width: 620px;
  margin: 0 auto;
  color: var(--home-ink-2);
  font-size: clamp(17px, 1.7vw, 20px);
  line-height: 1.55;
}

.desk__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 26px;
}

.is-reduced .desk__motion {
  transition: none;
}

.is-reduced .desk__float {
  animation: none;
}

@keyframes desk-float {
  from {
    transform: translateY(-0.5em);
  }

  to {
    transform: translateY(0.5em);
  }
}

@media (max-width: 760px) {
  /* Narrow screens crop a wider desk instead of shrinking the windows to illegibility. */
  .desk__viewport {
    width: 860px;
  }
}

@media (max-width: 640px) {
  .desk__copy {
    margin-top: 8px;
    padding: 0 16px;
  }
}
</style>
