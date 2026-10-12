<script setup lang="ts" generic="T extends string">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"

const props = defineProps<{
  options: { value: T; label: string }[]
  label: string
  size?: "large" | "small"
}>()
const model = defineModel<T>({ required: true })

const root = ref<HTMLElement>()
const indicator = ref({ left: 0, width: 0, ready: false })

function place() {
  const active = root.value?.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!active) return
  indicator.value = { left: active.offsetLeft, width: active.offsetWidth, ready: true }
}

let resize: ResizeObserver | undefined
onMounted(() => {
  place()
  resize = new ResizeObserver(place)
  if (root.value) resize.observe(root.value)
})
onBeforeUnmount(() => resize?.disconnect())
watch([model, () => props.options], () => nextTick(place))
</script>

<template>
  <div
    ref="root"
    class="segmented"
    :class="size === 'small' ? 'segmented--small' : 'segmented--large'"
    role="group"
    :aria-label="label"
  >
    <span
      class="segmented__indicator"
      :class="{ 'is-ready': indicator.ready }"
      :style="{ width: `${indicator.width}px`, translate: `${indicator.left}px 0` }"
      aria-hidden="true"
    />
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="segmented__option"
      :aria-pressed="model === option.value"
      @click="model = option.value"
    >
      <slot name="icon" :value="option.value" />
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  position: relative;
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 16px;
  background: var(--home-fill);
}

.segmented__indicator {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  border-radius: 12px;
  background: var(--home-window-solid);
  box-shadow:
    inset 0 0 0 1px var(--home-edge),
    0 1px 3px var(--home-shadow-near);
  opacity: 0;
}

.segmented__indicator.is-ready {
  opacity: 1;
  transition:
    translate 0.35s var(--home-ease),
    width 0.35s var(--home-ease);
}

.segmented__option {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border-radius: 12px;
  color: var(--home-ink-2);
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.2s;
}

.segmented--large .segmented__option {
  height: 48px;
  padding: 0 16px;
  font-size: 16px;
}

.segmented--small .segmented__option {
  height: 34px;
  padding: 0 14px;
  font-size: 14px;
}

.segmented__option[aria-pressed="true"],
.segmented__option:hover {
  color: var(--home-ink);
}

.segmented__option:focus-visible {
  outline: 2px solid var(--home-violet);
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .segmented__indicator.is-ready {
    transition: none;
  }
}
</style>
