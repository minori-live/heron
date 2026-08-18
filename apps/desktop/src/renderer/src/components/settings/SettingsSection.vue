<script setup lang="ts">
defineProps<{
  eyebrow?: string
  title: string
  description: string
}>()

defineSlots<{
  default(): unknown
}>()
</script>

<template>
  <section
    class="settings-section grid grid-cols-[minmax(170px,230px)_minmax(0,1fr)] gap-[48px] border-b border-b-solid py-[25px] [border-bottom-color:var(--line-soft)]"
  >
    <header class="settings-section-copy">
      <span v-if="eyebrow">{{ eyebrow }}</span>
      <h3>{{ title }}</h3>
      <p>{{ description }}</p>
    </header>
    <div class="min-w-0">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-section-copy span {
  display: block;
  margin-bottom: 7px;
  color: var(--accent);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wider);
  text-transform: uppercase;
}

.settings-section-copy h3 {
  margin: 0 0 6px;
  font: var(--ui-type-weight-semibold) var(--ui-type-size-section-title)
    var(--ui-type-family-display);
  letter-spacing: var(--ui-type-tracking-wide);
}

.settings-section-copy p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--ui-type-size-body-compact);
  line-height: var(--ui-type-leading-normal);
}

@media (max-width: 1120px) {
  .settings-section {
    grid-template-columns: 1fr;
    gap: 17px;
  }
}
</style>
