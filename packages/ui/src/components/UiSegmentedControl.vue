<script setup lang="ts">
import { ToggleGroupItem, ToggleGroupRoot } from "reka-ui"
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"

import type { UiControlSize, UiSegmentedOption } from "../types"

const model = defineModel<string>({ required: true })
const props = withDefaults(
  defineProps<{
    label: string
    options: readonly UiSegmentedOption[]
    size?: "compact" | UiControlSize
    disabled?: boolean
    appearance?: "default" | "separated"
    required?: boolean
  }>(),
  {
    size: "sm",
    disabled: false,
    appearance: "default",
    required: false
  }
)
function select(value: unknown): void {
  if (typeof value === "string" && (value !== "" || !props.required)) model.value = value
}

// The raised indicator travels between segments, as on the product website. It is
// presentation only: `data-state` on the item remains the selected-state carrier.
const root = ref<{ $el: HTMLElement }>()
const indicator = ref({ left: 0, width: 0, visible: false, ready: false })

function place(): void {
  const element = root.value?.$el
  const active = element?.querySelector<HTMLElement>('[data-state="on"]')
  if (!active) {
    indicator.value = { ...indicator.value, visible: false }
    return
  }
  indicator.value = {
    left: active.offsetLeft,
    width: active.offsetWidth,
    visible: true,
    ready: indicator.value.visible
  }
}

let resize: ResizeObserver | undefined
onMounted(() => {
  place()
  resize = new ResizeObserver(place)
  resize.observe(root.value!.$el)
})
onBeforeUnmount(() => resize?.disconnect())
watch([model, () => props.options], () => nextTick(place))
</script>

<template>
  <ToggleGroupRoot
    ref="root"
    :model-value="model"
    class="ui-segmented"
    :class="[`ui-segmented--${props.size}`, `ui-segmented--${props.appearance}`]"
    type="single"
    orientation="horizontal"
    :disabled="props.disabled"
    :aria-label="props.label"
    @update:model-value="select"
  >
    <span
      v-if="props.appearance === 'default'"
      class="ui-segmented__indicator"
      :class="{ 'is-visible': indicator.visible, 'is-ready': indicator.ready }"
      :style="{ width: `${indicator.width}px`, translate: `${indicator.left}px 0` }"
      aria-hidden="true"
    />
    <ToggleGroupItem
      v-for="option in props.options"
      :key="option.value"
      class="ui-segmented__item"
      :value="option.value"
      :disabled="option.disabled"
      :aria-label="option.ariaLabel"
    >
      {{ option.label }}
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>

<style scoped>
.ui-segmented {
  position: relative;
  display: inline-flex;
  min-width: 0;
  align-items: stretch;
  gap: 2px;
  padding: 3px;
  border-radius: var(--ui-radius-md);
  background: var(--ui-color-fill);
}

.ui-segmented__indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  border-radius: calc(var(--ui-radius-md) - 3px);
  background: var(--ui-color-surface-raised);
  box-shadow: var(--ui-shadow-raised);
  opacity: 0;
  pointer-events: none;
}

.ui-segmented__indicator.is-visible {
  opacity: 1;
}

.ui-segmented__indicator.is-ready {
  transition:
    translate var(--ui-motion-slow) var(--ui-ease-emphasized),
    width var(--ui-motion-slow) var(--ui-ease-emphasized);
}

.ui-segmented__item {
  position: relative;
  z-index: var(--ui-z-local-content);
  min-width: 0;
  border: 0;
  border-radius: calc(var(--ui-radius-md) - 3px);
  color: var(--ui-color-text-muted);
  background: transparent;
  font-weight: var(--ui-type-weight-strong);
  line-height: var(--ui-type-leading-tight);
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--ui-motion-normal);
}

.ui-segmented__item:hover:not(:disabled) {
  color: var(--ui-color-text);
}

.ui-segmented__item[data-state="on"] {
  color: var(--ui-color-text);
}

.ui-segmented__item:focus-visible {
  outline-offset: -2px;
}

.ui-segmented__item:disabled {
  cursor: not-allowed;
  opacity: var(--ui-opacity-disabled);
}

.ui-segmented--compact {
  padding: 2px;
  border-radius: var(--ui-radius-sm);
}

.ui-segmented--compact .ui-segmented__indicator {
  top: 2px;
  bottom: 2px;
  border-radius: calc(var(--ui-radius-sm) - 2px);
}

.ui-segmented--compact .ui-segmented__item {
  border-radius: calc(var(--ui-radius-sm) - 2px);
  min-height: calc(var(--ui-control-compact) - 4px);
  padding: 0 var(--ui-space-2);
  font-size: var(--ui-type-size-control);
}

.ui-segmented--sm .ui-segmented__item {
  min-height: calc(var(--ui-control-sm) - 6px);
  padding: 0 var(--ui-space-3);
  font-size: var(--ui-font-size-xs);
}

.ui-segmented--md .ui-segmented__item {
  min-height: calc(var(--ui-control-md) - 6px);
  padding: 0 var(--ui-space-4);
  font-size: var(--ui-font-size-sm);
}

.ui-segmented--lg .ui-segmented__item {
  min-height: calc(var(--ui-control-lg) - 6px);
  padding: 0 var(--ui-space-5);
  font-size: var(--ui-font-size-md);
}

.ui-segmented--separated {
  gap: 2px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.ui-segmented--separated .ui-segmented__item {
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  color: var(--ui-color-text-muted);
  background: var(--ui-color-fill);
  font: var(--ui-type-weight-strong) var(--ui-type-size-caption) var(--ui-type-family-interface);
}
.ui-segmented--separated .ui-segmented__item[data-state="on"] {
  border-color: color-mix(in srgb, var(--ui-color-action) 28%, transparent);
  color: var(--ui-color-text);
  background: color-mix(in srgb, var(--ui-color-action) 20%, transparent);
}
.ui-segmented--separated .ui-segmented__item:hover:not(:disabled):not([data-state="on"]) {
  background: var(--ui-color-fill-hover);
}
.ui-segmented--separated .ui-segmented__item:focus-visible {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: 1px;
  box-shadow: none;
}
</style>
