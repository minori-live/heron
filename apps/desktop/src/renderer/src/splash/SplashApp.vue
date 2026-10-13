<script setup lang="ts">
import { HeronLogo } from "@heron/ui"
import { useLocaleFonts } from "@heron/ui"
import { computed, onMounted, watch } from "vue"
import { useHead } from "@unhead/vue"
import { useI18n } from "vue-i18n"
import { setAppLocale } from "../i18n"
import { useStartupStore } from "../stores/startup"

const startup = useStartupStore()
const projectUrl = "https://github.com/minori-live/heron"
const appVersion = __APP_VERSION__
const percentage = computed(() => Math.round(startup.progress.progress * 100))

const { t } = useI18n()
const locale = computed(() => startup.progress.locale)
watch(locale, setAppLocale, { immediate: true })
useLocaleFonts(locale)
useHead({ title: () => t("startup.starting") })

onMounted(() => void startup.load())
</script>

<template>
  <main
    class="splash-shell relative grid h-full w-full grid-rows-[1fr_auto] overflow-hidden border border-solid border-[var(--ui-color-glass-edge)] bg-ui-canvas px-[48px] pb-[40px] pt-[44px]"
    :data-phase="startup.progress.phase"
  >
    <header
      class="brand relative z-[var(--ui-z-local-content)] flex flex-col items-center justify-center self-stretch text-center"
    >
      <h1 class="m-0"><HeronLogo class="brand-logo" /></h1>
      <p class="project-url">{{ projectUrl }}</p>
      <p class="version">v{{ appVersion }}</p>
    </header>

    <section class="relative z-[var(--ui-z-local-content)] w-full" aria-live="polite">
      <div class="status-heading mb-[10px] flex items-center justify-between">
        <p>{{ startup.progress.label }}</p>
        <strong>{{ percentage }}%</strong>
      </div>

      <div
        class="progress-track"
        role="progressbar"
        :aria-label="startup.progress.label"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="percentage"
      >
        <span class="progress-fill" :style="{ width: `${percentage}%` }" />
      </div>
    </section>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html),
:global(body),
:global(#splash-root) {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

:global(body) {
  color: var(--ui-color-text);
  background: var(--ui-color-canvas);
  font-family: var(--ui-type-family-interface);
  user-select: none;
}

.splash-shell {
  background:
    radial-gradient(
      60% 80% at 14% 12%,
      color-mix(in srgb, var(--ui-signal-audio) 11%, transparent),
      transparent 70%
    ),
    radial-gradient(
      50% 70% at 92% 30%,
      color-mix(in srgb, var(--ui-signal-record) 8%, transparent),
      transparent 70%
    ),
    radial-gradient(
      70% 70% at 40% 105%,
      color-mix(in srgb, var(--ui-signal-midi) 12%, transparent),
      transparent 70%
    ),
    var(--ui-color-canvas);
  -webkit-app-region: drag;
}

.splash-shell::before {
  position: absolute;
  inset: -28% -12% 12%;
  background: radial-gradient(
    circle at 50% 52%,
    color-mix(in srgb, var(--ui-signal-audio) 14%, transparent),
    transparent 48%
  );
  content: "";
  pointer-events: none;
  transform-origin: 50% 48%;
  animation: splash-glow-breathe 4.8s ease-in-out infinite;
  will-change: opacity, transform;
}

.brand-logo {
  --heron-logo-lockup-wordmark-size: 0.62em;

  color: var(--ui-color-text);
  font-size: var(--ui-font-size-5xl);
}

.project-url,
.status-heading {
  font-family: var(--ui-type-family-interface);
}

.version,
.status-heading > strong {
  font-family: var(--ui-type-family-data);
}

.project-url {
  margin: 22px 0 0;
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-control);
  letter-spacing: var(--ui-type-tracking-normal);
}

.version {
  margin: 8px 0 0;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
  letter-spacing: var(--ui-type-tracking-normal);
  font-variant-numeric: tabular-nums;
}

.status-heading {
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-control);
}

.status-heading p {
  margin: 0;
  overflow: hidden;
  letter-spacing: var(--ui-type-tracking-normal);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-heading > strong {
  color: var(--ui-color-text);
  font-weight: var(--ui-type-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.progress-track {
  position: relative;
  height: 8px;
  overflow: hidden;
  border: 1px solid var(--ui-color-glass-edge);
  border-radius: var(--ui-radius-pill);
  background: var(--ui-color-fill);
}

.progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  min-width: 2px;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--ui-signal-audio) 76%, var(--ui-color-canvas)),
      var(--ui-signal-audio) 72%,
      var(--ui-signal-midi)
    ),
    var(--ui-signal-audio);
  box-shadow: var(--ui-shadow-selected-outline);
  transition: width 180ms ease-out;
}

.splash-shell[data-phase="failed"] .status-heading {
  color: var(--ui-color-danger);
}

.splash-shell[data-phase="failed"] .progress-fill {
  background: var(--ui-color-danger);
  box-shadow: var(--ui-focus-ring);
}

@keyframes splash-glow-breathe {
  0%,
  100% {
    opacity: 0.48;
    transform: scale(0.94);
  }

  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}

@media (prefers-reduced-motion: reduce) {
  .splash-shell::before {
    opacity: 0.72;
    transform: none;
    animation: none;
  }

  .progress-fill {
    transition: none;
  }
}
</style>
