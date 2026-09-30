<script setup lang="ts">
defineProps<{
  leftPanelOpen: boolean
  rightPanelOpen: boolean
}>()
</script>

<template>
  <main
    class="document-workspace-shell"
    :class="{
      'left-panel-open': leftPanelOpen,
      'right-panel-open': rightPanelOpen
    }"
  >
    <slot />
  </main>
</template>

<style scoped>
.document-workspace-shell {
  display: grid;
  grid-template: 56px minmax(0, 1fr) 25px / minmax(0, 1fr);
  width: 100%;
  height: 100%;
  color: var(--ui-color-text);
  background: var(--ui-color-canvas);
  -webkit-user-select: none;
  user-select: none;
}
.document-workspace-shell.left-panel-open {
  grid-template-columns: 214px minmax(0, 1fr);
}
.document-workspace-shell.right-panel-open {
  grid-template-columns: minmax(0, 1fr) auto;
}
.document-workspace-shell.left-panel-open.right-panel-open {
  grid-template-columns: 214px minmax(0, 1fr) auto;
}
.document-workspace-shell
  :deep(:is(input, textarea, select, [contenteditable]:not([contenteditable="false"]))) {
  -webkit-user-select: text;
  user-select: text;
}
@media (max-width: 1100px) {
  .document-workspace-shell.left-panel-open {
    grid-template-columns: 184px minmax(0, 1fr);
  }
  .document-workspace-shell.left-panel-open.right-panel-open {
    grid-template-columns: 184px minmax(0, 1fr) auto;
  }
}
</style>
