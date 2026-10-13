<script setup lang="ts">
import type { RevoxCopy } from "./heron-revox-copy"

defineProps<{ copy: RevoxCopy }>()
</script>

<template>
  <section class="uses" aria-labelledby="uses-title">
    <h2 id="uses-title" class="section-title">{{ copy.usesTitle }}</h2>
    <div class="use-grid">
      <div v-for="use in copy.uses" :key="use.name" class="use">
        <h3 class="use-name">{{ use.name }}</h3>
        <p class="use-body">{{ use.body }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-title {
  margin: 0;
  font-family: var(--heron-display);
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 550;
  letter-spacing: -0.025em;
  line-height: 1.3;
}
.uses {
  padding: 54px 0 64px;
  border-top: 1px solid var(--vp-c-divider);
}
.use-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 40px;
  margin-top: 48px;
}
.use-name {
  margin: 0 0 12px;
  color: var(--vp-c-brand-1);
  font-size: 22px;
  font-weight: 500;
}
.use-body {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.8;
}
@media (max-width: 700px) {
  .use-grid {
    grid-template-columns: 1fr;
    gap: 24px;
    margin-top: 32px;
  }
}
</style>
