<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import type { DesktopPlatform } from "@heron/contracts"
import { HeronLogo } from "@heron/ui"
import AsioLegalNotice from "./AsioLegalNotice.vue"
import ThirdPartyNotices from "./ThirdPartyNotices.vue"
import VstLegalNotice from "./VstLegalNotice.vue"

const props = defineProps<{
  version: string
  platform: DesktopPlatform
}>()

const { t } = useI18n()
const platformLabel = computed(() => t(`about.platforms.${props.platform}`))
const projectUrl = "https://github.com/minori-live/heron"
const manualUrl = "https://heron.minori.live/manual/"
</script>

<template>
  <article class="about-panel">
    <div class="brand-stage">
      <HeronLogo class="brand-logo" />
    </div>

    <dl class="build-facts">
      <div class="build-fact">
        <dt class="fact-label">{{ t("about.version") }}</dt>
        <dd class="fact-value">v{{ version }}</dd>
      </div>
      <div class="build-fact">
        <dt class="fact-label">{{ t("about.platform") }}</dt>
        <dd class="fact-value">{{ platformLabel }}</dd>
      </div>
      <div class="build-fact">
        <dt class="fact-label">{{ t("about.license") }}</dt>
        <dd class="fact-value">GPL-3.0-only</dd>
      </div>
    </dl>

    <VstLegalNotice />
    <AsioLegalNotice />
    <ThirdPartyNotices />

    <nav class="about-links" :aria-label="t('about.links')">
      <a class="about-link" :href="projectUrl" target="_blank" rel="noopener noreferrer">
        <span class="link-label">{{ t("about.projectWebsite") }}</span>
        <span class="link-arrow" aria-hidden="true">↗</span>
      </a>
      <a class="about-link" :href="manualUrl" target="_blank" rel="noreferrer">
        <span class="link-label">{{ t("about.userManual") }}</span>
        <span class="link-arrow" aria-hidden="true">↗</span>
      </a>
    </nav>
  </article>
</template>

<style scoped>
.about-panel {
  display: grid;
  gap: var(--ui-space-5);
}

.brand-stage {
  display: grid;
  min-height: 7.5rem;
  align-content: center;
  justify-items: center;
  padding: var(--ui-space-6);
  border: 1px solid var(--ui-color-glass-edge);
  border-left: var(--ui-signal-rail-width) solid var(--ui-signal-audio);
  border-radius: var(--ui-radius-lg);
  background:
    radial-gradient(
      70% 120% at 18% 0%,
      color-mix(in srgb, var(--ui-signal-audio) 10%, transparent),
      transparent 70%
    ),
    radial-gradient(
      60% 120% at 90% 100%,
      color-mix(in srgb, var(--ui-signal-midi) 10%, transparent),
      transparent 70%
    ),
    var(--ui-color-fill);
}

.brand-logo {
  --heron-logo-lockup-wordmark-size: 0.62em;

  color: var(--ui-color-text);
  font-size: var(--ui-font-size-4xl);
}

.build-facts {
  display: grid;
  margin: 0;
  border: 1px solid var(--ui-color-glass-edge);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-color-fill);
}

.build-fact {
  display: grid;
  grid-template-columns: minmax(6rem, 0.7fr) minmax(0, 1.3fr);
  align-items: baseline;
  gap: var(--ui-space-4);
  padding: var(--ui-space-3) var(--ui-space-4);
  border-top: 1px solid var(--ui-color-glass-edge);
}

.build-fact:first-child {
  border-top: 0;
}

.fact-label {
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-font-size-xs);
}

.fact-value {
  overflow: hidden;
  margin: 0;
  color: var(--ui-color-text);
  font: var(--ui-font-size-xs) var(--ui-type-family-data);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.about-links {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ui-space-2);
}

.about-link {
  display: flex;
  min-height: var(--ui-control-md);
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-3);
  padding: 0 var(--ui-space-3);
  border: 1px solid var(--ui-color-glass-edge);
  border-radius: var(--ui-radius-pill);
  color: var(--ui-color-text);
  background: var(--ui-color-fill);
  font-size: var(--ui-font-size-xs);
  font-weight: var(--ui-type-weight-strong);
  text-decoration: none;
  transition:
    background var(--ui-motion-fast) var(--ui-ease-standard),
    border-color var(--ui-motion-fast) var(--ui-ease-standard);
}

.link-arrow {
  color: var(--ui-color-accent);
}

@media (max-width: 30rem) {
  .about-links {
    grid-template-columns: 1fr;
  }
}
</style>
