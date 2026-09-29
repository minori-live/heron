<template>
  <header
    class="topbar col-span-full flex h-[56px] min-w-0 items-center justify-between gap-[clamp(4px,0.55vw,10px)] border-b border-b-solid px-[12px] py-[5px] [border-bottom-color:var(--line-strong)]"
  >
    <slot />
  </header>
</template>

<style scoped>
.topbar {
  background: color-mix(in srgb, var(--surface-1) 96%, transparent);
  box-shadow:
    0 1px 0 var(--ui-domain-color-ffffff05) inset,
    0 8px 22px var(--shadow);
}
@media (max-width: 1279px) {
  .topbar {
    gap: 5px;
    padding-right: 8px;
    padding-left: 8px;
  }
}
</style>
