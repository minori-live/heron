<script setup lang="ts">
import { computed } from "vue"
import { useData, withBase } from "vitepress"
import VstTrademarkNotice from "../VstTrademarkNotice.vue"
import HeronEqDetails from "./HeronEqDetails.vue"
import HeronStudioIncluded from "./HeronStudioIncluded.vue"
import PluginFeatureGrid from "./PluginFeatureGrid.vue"
import PluginCompatibility from "./PluginCompatibility.vue"
import ProductHero from "../product/ProductHero.vue"
import { eqCopy } from "./heron-eq-copy"

const { localeIndex } = useData()
const locale = computed(() => (localeIndex.value === "zh" ? "zh" : "en"))
const copy = computed(() => eqCopy[locale.value])
const prefix = computed(() => (locale.value === "zh" ? "/zh" : ""))
const downloadHref = computed(() => withBase(`${prefix.value}/plugins/releases`))
const manualHref = computed(() => withBase(`${prefix.value}/plugins/manual/heron-eq`))
const image = withBase("/plugins/heron-eq.png")
</script>

<template>
  <main class="eq-page">
    <ProductHero
      name="Heron EQ"
      :tagline="copy.tagline"
      :intro-title="copy.introTitle"
      :intro="copy.intro"
      :included="copy.included"
      :image="image"
      :image-alt="copy.imageAlt"
      :image-width="2080"
      :image-height="1400"
      :enlarge="copy.enlarge"
      :download-href="downloadHref"
      :download-label="copy.download"
      :manual-href="manualHref"
      :manual-label="copy.manual"
    >
      <template #support>
        <PluginCompatibility class="eq-support" :locale="locale" compact />
      </template>
    </ProductHero>
    <div class="eq-content">
      <PluginFeatureGrid :title="copy.featuresTitle" :image="image" :features="copy.features" />
      <HeronEqDetails :copy="copy" />
      <section class="eq-start" aria-labelledby="start-title">
        <div>
          <h2 id="start-title" class="eq-start-title">{{ copy.startTitle }}</h2>
          <p class="eq-start-body">{{ copy.startBody }}</p>
        </div>
        <a class="eq-download" :href="downloadHref">{{ copy.download }}</a>
      </section>
      <HeronStudioIncluded :locale="locale" />
      <VstTrademarkNotice class="eq-trademark" />
    </div>
  </main>
</template>

<style scoped>
.eq-page {
  color: var(--vp-c-text-1);
}
.eq-support {
  justify-content: center;
}
.eq-content {
  width: min(1180px, calc(100% - 80px));
  margin: 0 auto;
  padding-bottom: 56px;
}
.eq-start {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 48px;
  padding: 48px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.eq-start-title {
  margin: 0;
  font-family: var(--heron-display);
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 550;
  line-height: 1.3;
}
.eq-start-body {
  max-width: 720px;
  margin: 18px 0 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.8;
}
.eq-download {
  flex-shrink: 0;
  padding: 14px 26px;
  border-radius: 28px;
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}
.eq-download:hover {
  background: var(--vp-c-brand-2);
}
.eq-download:focus-visible {
  outline: 3px solid var(--vp-c-brand-1);
  outline-offset: 5px;
}
.eq-trademark {
  --trademark-notice-margin-top: 0;
}
@media (max-width: 900px) {
  .eq-content {
    width: calc(100% - 48px);
  }
  .eq-start {
    align-items: start;
    flex-direction: column;
    gap: 28px;
  }
}
@media (max-width: 540px) {
  .eq-content {
    width: calc(100% - 40px);
  }
}
</style>
