<script setup lang="ts">
defineProps<{
  category: string
  page: string
  title: string
  description: string
}>()

defineSlots<{
  default(): unknown
}>()
</script>

<template>
  <section
    class="ui-preferences-surface min-w-0 overflow-auto bg-[var(--ui-color-canvas)] px-[clamp(30px,4.5vw,68px)] pb-[60px] pt-[38px]"
  >
    <header class="settings-page-intro max-w-[900px]">
      <span class="settings-page-path">
        {{ category }}
        <b aria-hidden="true">/</b>
        {{ page }}
      </span>
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
    </header>
    <div
      class="settings-page-body mt-[25px] max-w-[900px] border-t border-t-solid [border-top-color:var(--ui-color-glass-edge)]"
    >
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-page-path {
  color: var(--ui-color-accent);
  font: var(--ui-type-weight-strong) var(--ui-type-size-caption) var(--ui-type-family-interface);
  letter-spacing: var(--ui-type-tracking-eyebrow);
  text-transform: uppercase;
}

.settings-page-path b {
  margin: 0 5px;
  color: var(--ui-color-text-faint);
  font-weight: var(--ui-type-weight-medium);
}

.settings-page-intro h2 {
  margin: 8px 0 6px;
  font: var(--ui-type-weight-heavy) var(--ui-font-size-2xl) / var(--ui-type-leading-tight)
    var(--ui-type-family-display);
  letter-spacing: var(--ui-type-tracking-display);
  text-wrap: balance;
}

.settings-page-intro p {
  margin: 0;
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-body-compact);
  line-height: var(--ui-type-leading-normal);
}
</style>
