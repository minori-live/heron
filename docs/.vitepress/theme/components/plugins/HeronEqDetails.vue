<script setup lang="ts">
import type { EqCopy } from "./heron-eq-copy"

defineProps<{ copy: EqCopy }>()
</script>

<template>
  <section class="modes" aria-labelledby="modes-title">
    <h2 id="modes-title" class="section-title">{{ copy.modesTitle }}</h2>
    <div class="mode-grid">
      <div v-for="mode in copy.modes" :key="mode.name" class="mode">
        <h3 class="mode-name">{{ mode.name }}</h3>
        <p class="mode-body">{{ mode.body }}</p>
      </div>
    </div>
  </section>
  <section class="specifications" aria-labelledby="specifications-title">
    <h2 id="specifications-title" class="section-title">{{ copy.specificationsTitle }}</h2>
    <ul class="specification-list">
      <li v-for="item in copy.specifications" :key="item" class="specification">{{ item }}</li>
    </ul>
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
.modes {
  padding: 54px 0 64px;
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 40px;
  margin-top: 48px;
}
.mode-name {
  margin: 0 0 12px;
  color: var(--vp-c-brand-1);
  font-size: 22px;
  font-weight: 500;
}
.mode-body {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.8;
}
.specifications {
  padding: 80px 0;
}
.specification-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 72px;
  row-gap: 18px;
  margin: 36px 0 0;
  padding-left: 20px;
  list-style: disc;
}
.specification {
  padding-left: 6px;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.7;
}
.specification::marker {
  color: var(--vp-c-brand-1);
}
@media (max-width: 700px) {
  .mode-grid,
  .specification-list {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .mode-grid {
    margin-top: 32px;
  }
  .specifications {
    padding: 56px 0;
  }
}
</style>
