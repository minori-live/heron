<script setup lang="ts">
export interface PluginFeatureCard {
  title: string
  body: string
  /** SVG viewBox crop into the shared `image` (EQ-style). */
  crop?: string
  /** Dedicated illustration for this card (Revox-style). */
  media?: string
  mediaAlt?: string
}

withDefaults(
  defineProps<{
    title: string
    features: PluginFeatureCard[]
    image?: string
    imageWidth?: number
    imageHeight?: number
  }>(),
  { image: "", imageWidth: 2080, imageHeight: 1400 }
)
</script>

<template>
  <section class="feature-section" aria-labelledby="features-title">
    <h2 id="features-title" class="section-title">{{ title }}</h2>
    <div class="feature-grid">
      <article v-for="feature in features" :key="feature.title" class="feature">
        <img
          v-if="feature.media"
          class="feature-image feature-image-media"
          :src="feature.media"
          :alt="feature.mediaAlt || ''"
          loading="lazy"
        />
        <svg
          v-else-if="feature.crop && image"
          class="feature-image"
          :viewBox="feature.crop"
          aria-hidden="true"
        >
          <image :href="image" :width="imageWidth" :height="imageHeight" />
        </svg>
        <div class="feature-copy">
          <h3 class="feature-title">{{ feature.title }}</h3>
          <p class="feature-body">{{ feature.body }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.feature-section {
  padding: 48px 0 88px;
}
.section-title {
  margin: 0 0 38px;
  font-family: var(--heron-display);
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 550;
  letter-spacing: -0.025em;
  line-height: 1.3;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
}
.feature {
  overflow: hidden;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
.feature-image {
  display: block;
  width: 100%;
  aspect-ratio: 2;
  background: #242426;
}
.feature-image-media {
  object-fit: cover;
  object-position: center;
}
.feature-copy {
  padding: 28px;
}
.feature-title {
  margin: 0 0 18px;
  color: var(--vp-c-brand-1);
  font-size: 22px;
  font-weight: 550;
  line-height: 1.45;
}
.feature-body {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.85;
}
@media (max-width: 900px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .feature {
    display: grid;
    grid-template-columns: 0.9fr 1.1fr;
    align-items: start;
  }
  .feature-image {
    height: 100%;
    object-fit: cover;
  }
}
@media (max-width: 540px) {
  .feature-section {
    padding: 24px 0 56px;
  }
  .feature {
    display: block;
  }
  .feature-copy {
    padding: 24px;
  }
}
</style>
