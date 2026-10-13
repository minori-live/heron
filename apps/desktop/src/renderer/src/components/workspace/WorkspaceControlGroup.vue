<template>
  <div class="control-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]">
    <slot />
  </div>
</template>

<style scoped>
.control-group {
  border: 1px solid transparent;
  background: var(--ui-color-fill);
}
@media (max-width: 1279px) {
  .control-group {
    padding: 1px;
  }
}
</style>
