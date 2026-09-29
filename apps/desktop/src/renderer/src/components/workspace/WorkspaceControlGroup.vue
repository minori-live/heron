<template>
  <div class="control-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]">
    <slot />
  </div>
</template>

<style scoped>
.control-group {
  border: 1px solid color-mix(in srgb, var(--ui-color-border-strong) 72%, transparent);
  background: color-mix(in srgb, var(--ui-daw-control) 78%, transparent);
  box-shadow: 0 1px 0 var(--ui-domain-color-ffffff05) inset;
}
@media (max-width: 1279px) {
  .control-group {
    padding: 1px;
  }
}
</style>
