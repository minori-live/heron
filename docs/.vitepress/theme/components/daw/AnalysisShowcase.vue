<script setup lang="ts">
import { useId } from "vue"

withDefaults(
  defineProps<{
    title: string
    body: string
    image: string
    imageWidth: number
    imageHeight: number
    enlarge: string
    reverse?: boolean
  }>(),
  { reverse: false }
)

const titleId = useId()
</script>

<template>
  <section
    class="analysis-showcase"
    :class="{ 'analysis-showcase--reverse': reverse }"
    :aria-labelledby="titleId"
  >
    <div class="showcase-copy">
      <h2 :id="titleId" class="showcase-title">{{ title }}</h2>
      <p class="showcase-body">{{ body }}</p>
    </div>
    <a
      class="showcase-image-link"
      :href="image"
      :aria-label="`${enlarge}: ${title}`"
      target="_blank"
      rel="noreferrer"
    >
      <img
        class="showcase-image"
        :src="image"
        :width="imageWidth"
        :height="imageHeight"
        :alt="title"
        loading="lazy"
      />
    </a>
  </section>
</template>

<style scoped>
.analysis-showcase {
  display: grid;
  grid-template-columns: 0.8fr 1.2fr;
  align-items: center;
  gap: 64px;
  padding: 72px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.analysis-showcase--reverse {
  grid-template-columns: 1.2fr 0.8fr;
}
.analysis-showcase--reverse .showcase-image-link {
  grid-column: 1;
  grid-row: 1;
}
.showcase-title {
  margin: 0 0 24px;
  font-family: var(--heron-display);
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 550;
  letter-spacing: -0.025em;
  line-height: 1.3;
}
.showcase-body {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.85;
}
.showcase-image-link {
  display: block;
  overflow: hidden;
  border: 1px solid var(--vp-c-border);
  border-radius: 9px;
  background: #242426;
}
.showcase-image-link:focus-visible {
  outline: 3px solid var(--vp-c-brand-1);
  outline-offset: 5px;
}
.showcase-image {
  display: block;
  width: 100%;
  height: auto;
}
@media (max-width: 900px) {
  .analysis-showcase {
    grid-template-columns: 1fr;
    gap: 32px;
    padding: 56px 0;
  }
  .analysis-showcase--reverse .showcase-image-link {
    grid-column: auto;
    grid-row: auto;
  }
}
</style>
