<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    /** Window width in em; the content scales with the window. */
    basis: number
    surface?: "glass" | "plugin"
  }>(),
  { surface: "glass" }
)
</script>

<template>
  <div class="app-window" :class="`app-window--${surface}`">
    <div class="app-window__frame" :style="{ fontSize: `calc(100cqw / ${basis})` }">
      <div class="app-window__bar">
        <span class="app-window__lights" aria-hidden="true"><i /><i /><i /></span>
        <span class="app-window__title">{{ title }}</span>
        <span class="app-window__end"><slot name="bar" /></span>
      </div>
      <div class="app-window__body"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.app-window {
  container-type: inline-size;
  width: 100%;
  height: 100%;
}

.app-window__frame {
  display: flex;
  overflow: hidden;
  height: 100%;
  flex-direction: column;
  border: 1px solid var(--home-edge);
  border-radius: 0.9em;
  color: var(--home-ink);
  background: var(--home-window);
  box-shadow:
    0 2em 3.6em -1.4em var(--home-shadow),
    0 0.25em 0.8em -0.2em var(--home-shadow-near);
  backdrop-filter: blur(22px) saturate(1.4);
  font-family: var(--vp-font-family-base);
  line-height: 1.2;
}

.app-window--plugin .app-window__frame {
  border-color: rgb(255 255 255 / 9%);
  color: #e9ecef;
  background: #171a1f;
}

.app-window__bar {
  display: grid;
  height: 2.3em;
  flex: none;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 0.9em;
  border-bottom: 1px solid var(--home-edge);
}

.app-window--plugin .app-window__bar {
  border-bottom-color: rgb(255 255 255 / 7%);
  background: #1d2128;
}

.app-window__lights {
  display: flex;
  gap: 0.42em;
}

.app-window__lights i {
  width: 0.72em;
  height: 0.72em;
  border-radius: 50%;
  background: #ff5f57;
}

.app-window__lights i:nth-child(2) {
  background: #febc2e;
}

.app-window__lights i:nth-child(3) {
  background: #28c840;
}

.app-window__title {
  color: var(--home-ink-2);
  font-size: 0.86em;
  font-weight: 650;
  letter-spacing: -0.005em;
}

.app-window--plugin .app-window__title {
  color: #aeb4bd;
}

.app-window__end {
  display: flex;
  justify-content: flex-end;
}

.app-window__body {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
</style>
