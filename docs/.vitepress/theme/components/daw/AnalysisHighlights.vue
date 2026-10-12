<script setup lang="ts">
import type { AnalysisFeature } from "./plugin-analysis-copy"

defineProps<{ title: string; features: AnalysisFeature[]; images: string[] }>()
</script>

<template>
  <section class="analysis-highlights" aria-labelledby="analysis-highlights-title">
    <h2 id="analysis-highlights-title" class="highlights-title">{{ title }}</h2>
    <div class="highlights-grid">
      <article v-for="(feature, index) in features" :key="feature.title" class="highlight">
        <img
          class="highlight-image"
          :src="images[index]"
          width="2640"
          height="1624"
          alt=""
          loading="lazy"
        />
        <div class="highlight-copy">
          <h3 class="highlight-title">{{ feature.title }}</h3>
          <p class="highlight-body">{{ feature.body }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.analysis-highlights {
  padding: 48px 0 88px;
}
.highlights-title {
  margin: 0 0 38px;
  font-family: var(--heron-display);
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 550;
  letter-spacing: -0.025em;
  line-height: 1.3;
}
.highlights-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
}
.highlight {
  overflow: hidden;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
.highlight-image {
  display: block;
  width: 100%;
  height: auto;
  background: #242426;
}
.highlight-copy {
  padding: 28px;
}
.highlight-title {
  margin: 0 0 18px;
  color: var(--vp-c-brand-1);
  font-size: 22px;
  font-weight: 550;
  line-height: 1.45;
}
.highlight-body {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.85;
}
@media (max-width: 900px) {
  .highlights-grid {
    grid-template-columns: 1fr;
  }
  .highlight {
    display: grid;
    grid-template-columns: 0.9fr 1.1fr;
    align-items: center;
  }
}
@media (max-width: 540px) {
  .analysis-highlights {
    padding: 24px 0 56px;
  }
  .highlight {
    display: block;
  }
  .highlight-copy {
    padding: 24px;
  }
}
</style>
