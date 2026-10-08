<template>
  <footer class="plugin-analysis-view-controls"><slot /></footer>
</template>
<style scoped>
.plugin-analysis-view-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  min-height: 48px;
  padding: 8px 16px;
  border-top: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface);
  font-size: var(--ui-type-size-caption);
}
</style>
