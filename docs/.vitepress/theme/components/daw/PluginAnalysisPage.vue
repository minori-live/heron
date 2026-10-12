<script setup lang="ts">
import { computed } from "vue"
import { useData, withBase } from "vitepress"
import ProductHero from "../product/ProductHero.vue"
import PlatformIcon from "../product/PlatformIcon.vue"
import AnalysisDetails from "./AnalysisDetails.vue"
import AnalysisBackdrop from "./AnalysisBackdrop.vue"
import AnalysisHighlights from "./AnalysisHighlights.vue"
import { analysisCopy } from "./plugin-analysis-copy"

const { localeIndex } = useData()
const locale = computed(() => (localeIndex.value === "zh" ? "zh" : "en"))
const copy = computed(() => analysisCopy[locale.value])
const manualHref = computed(() =>
  withBase(`${locale.value === "zh" ? "/zh" : ""}/manual/plugin-analysis`)
)
const downloadHref = "https://github.com/minori-live/heron/releases"
const platforms = ["Windows", "macOS", "Linux"] as const
const image = withBase("/daw/plugin-analysis.jpg")
const featureImages = [
  withBase("/daw/plugin-analysis-phase.jpg"),
  withBase("/daw/plugin-analysis-harmonics.jpg"),
  withBase("/daw/plugin-analysis-performance.jpg")
]
</script>

<template>
  <main class="analysis-page">
    <ProductHero
      class="analysis-hero"
      name="Plugin Analysis"
      :tagline="copy.tagline"
      :intro-title="copy.introTitle"
      :intro="copy.intro"
      :included="copy.included"
      :image="image"
      :image-alt="copy.imageAlt"
      :image-width="2640"
      :image-height="1624"
      :enlarge="copy.enlarge"
      :download-href="downloadHref"
      :download-label="copy.download"
      :manual-href="manualHref"
      :manual-label="copy.manual"
    >
      <template #background>
        <AnalysisBackdrop />
      </template>
      <template #support>
        <ul
          class="analysis-support"
          :aria-label="locale === 'zh' ? '支持的平台' : 'Supported platforms'"
        >
          <li v-for="platform in platforms" :key="platform" class="analysis-platform">
            <PlatformIcon class="analysis-platform-icon" :name="platform" />
            {{ platform }}
          </li>
        </ul>
      </template>
    </ProductHero>
    <div class="analysis-content">
      <AnalysisHighlights
        :title="copy.featuresTitle"
        :features="copy.features"
        :images="featureImages"
      />
      <AnalysisDetails :copy="copy" />
      <section class="analysis-start" aria-labelledby="analysis-start-title">
        <div>
          <h2 id="analysis-start-title" class="analysis-start-title">{{ copy.startTitle }}</h2>
          <p class="analysis-start-body">{{ copy.startBody }}</p>
        </div>
        <a class="analysis-download" :href="downloadHref">{{ copy.download }}</a>
      </section>
    </div>
  </main>
</template>

<style scoped>
.analysis-page {
  color: var(--vp-c-text-1);
}
.analysis-hero {
  --product-name-width: 440px;
  --product-name-size: clamp(60px, 6.6vw, 94px);
}
.analysis-support {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 28px;
  margin: 0;
  padding: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.5;
  list-style: none;
}
.analysis-content {
  width: min(1180px, calc(100% - 80px));
  margin: 0 auto;
  padding-bottom: 56px;
}
.analysis-platform {
  display: flex;
  align-items: center;
  gap: 6px;
}
.analysis-platform-icon {
  flex-shrink: 0;
  width: 17px;
  height: 17px;
}
.analysis-start {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 48px;
  padding: 48px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.analysis-start-title {
  margin: 0;
  font-family: var(--heron-display);
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 550;
  letter-spacing: -0.025em;
  line-height: 1.3;
}
.analysis-start-body {
  max-width: 720px;
  margin: 18px 0 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.8;
}
.analysis-download {
  flex-shrink: 0;
  padding: 14px 26px;
  border-radius: 28px;
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}
.analysis-download:hover {
  background: var(--vp-c-brand-2);
}
.analysis-download:focus-visible {
  outline: 3px solid var(--vp-c-brand-1);
  outline-offset: 5px;
}
@media (max-width: 900px) {
  .analysis-content {
    width: calc(100% - 48px);
  }
  .analysis-start {
    align-items: start;
    flex-direction: column;
    gap: 28px;
  }
}
@media (max-width: 540px) {
  .analysis-content {
    width: calc(100% - 40px);
  }
}
</style>
