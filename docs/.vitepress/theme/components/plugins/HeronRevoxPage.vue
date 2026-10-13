<script setup lang="ts">
import { computed } from "vue"
import { useData, withBase } from "vitepress"
import VstTrademarkNotice from "../VstTrademarkNotice.vue"
import HeronRevoxDetails from "./HeronRevoxDetails.vue"
import PluginFeatureGrid from "./PluginFeatureGrid.vue"
import PluginCompatibility from "./PluginCompatibility.vue"
import ProductHero from "../product/ProductHero.vue"
import RevoxAcceleration from "./RevoxAcceleration.vue"
import { revoxCopy } from "./heron-revox-copy"

const { localeIndex } = useData()
const locale = computed(() => (localeIndex.value === "zh" ? "zh" : "en"))
const copy = computed(() => revoxCopy[locale.value])
const prefix = computed(() => (locale.value === "zh" ? "/zh" : ""))
const downloadHref = computed(() => withBase(`${prefix.value}/plugins/releases`))
const manualHref = computed(() => withBase(`${prefix.value}/plugins/manual/heron-revox`))
const image = withBase("/plugins/heron-revox.png")
const heroBackground = withBase("/plugins/heron-revox-hero-bg.png")
const features = computed(() =>
  copy.value.features.map((feature) => ({
    title: feature.title,
    body: feature.body,
    media: withBase(feature.media),
    mediaAlt: feature.mediaAlt
  }))
)
</script>

<template>
  <main class="revox-page">
    <ProductHero
      name="Heron Revox"
      :tagline="copy.tagline"
      :intro-title="copy.introTitle"
      :intro="copy.intro"
      :included="copy.included"
      :image="image"
      :image-alt="copy.imageAlt"
      :image-width="960"
      :image-height="600"
      :enlarge="copy.enlarge"
      :download-href="downloadHref"
      :download-label="copy.download"
      :manual-href="manualHref"
      :manual-label="copy.manual"
    >
      <template #background>
        <div class="revox-hero-bg" aria-hidden="true">
          <img class="revox-hero-bg-image" :src="heroBackground" alt="" />
          <div class="revox-hero-bg-fade" />
        </div>
      </template>
      <template #support>
        <PluginCompatibility class="revox-support" :locale="locale" compact />
      </template>
    </ProductHero>
    <div class="revox-content">
      <p class="revox-media-todo">{{ copy.mediaTodo }}</p>
      <PluginFeatureGrid :title="copy.featuresTitle" :features="features" />
      <HeronRevoxDetails :copy="copy" />
      <RevoxAcceleration
        :title="copy.accelerationTitle"
        :subtitle="copy.accelerationSubtitle"
        :platform-label="copy.accelerationPlatformLabel"
        :backends="copy.accelerationBackends"
        :rows="copy.accelerationRows"
        :legend-ready="copy.accelerationLegendReady"
        :legend-experimental="copy.accelerationLegendExperimental"
        :legend-none="copy.accelerationLegendNone"
      />
      <section class="revox-start" aria-labelledby="start-title">
        <div>
          <h2 id="start-title" class="revox-start-title">{{ copy.startTitle }}</h2>
          <p class="revox-start-body">{{ copy.startBody }}</p>
        </div>
        <a class="revox-download" :href="downloadHref">{{ copy.download }}</a>
      </section>
      <VstTrademarkNotice class="revox-trademark" />
    </div>
  </main>
</template>

<style scoped>
.revox-page {
  color: var(--vp-c-text-1);
}
.revox-hero-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.revox-hero-bg-image {
  position: absolute;
  top: -8%;
  left: 0;
  width: 100%;
  min-width: 1100px;
  height: 118%;
  object-fit: cover;
  object-position: center 42%;
  opacity: 0.55;
  filter: saturate(0.92) contrast(1.05);
  mask-image: linear-gradient(#000 42%, transparent 96%);
}
.revox-hero-bg-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgb(23 26 31 / 28%), rgb(23 26 31 / 78%) 72%);
}
.revox-support {
  justify-content: center;
}
.revox-content {
  width: min(1180px, calc(100% - 80px));
  margin: 0 auto;
  padding-bottom: 56px;
}
.revox-media-todo {
  margin: 0 0 8px;
  color: var(--vp-c-text-3);
  font-size: 13px;
  line-height: 1.6;
}
.revox-start {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 48px;
  padding: 48px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.revox-start-title {
  margin: 0;
  font-family: var(--heron-display);
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 550;
  line-height: 1.3;
}
.revox-start-body {
  max-width: 720px;
  margin: 18px 0 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.8;
}
.revox-download {
  flex-shrink: 0;
  padding: 14px 26px;
  border-radius: 28px;
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}
.revox-download:hover {
  background: var(--vp-c-brand-2);
}
.revox-download:focus-visible {
  outline: 3px solid var(--vp-c-brand-1);
  outline-offset: 5px;
}
.revox-trademark {
  --trademark-notice-margin-top: 0;
}
@media (max-width: 900px) {
  .revox-content {
    width: calc(100% - 48px);
  }
  .revox-start {
    align-items: start;
    flex-direction: column;
    gap: 28px;
  }
}
@media (max-width: 540px) {
  .revox-content {
    width: calc(100% - 40px);
  }
  .revox-hero-bg-image {
    left: -18%;
    min-width: 140%;
  }
}
</style>
