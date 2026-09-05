<script setup lang="ts">
import { computed } from "vue"

import type { UiNavigationCategory } from "../types"
import UiIconButton from "./UiIconButton.vue"

const model = defineModel<string>({ required: true })
const props = defineProps<{
  title: string
  scopeLabel: string
  backLabel: string
  categoriesLabel: string
  pagesLabel: string
  sidebarLabel?: string
  categories: readonly UiNavigationCategory[]
  buildLabel?: string
}>()
const emit = defineEmits<{ back: [] }>()
defineSlots<{
  "back-icon"(): unknown
  actions(): unknown
  "category-icon"(props: { category: UiNavigationCategory }): unknown
  "item-icon"(props: {
    category: UiNavigationCategory
    item: UiNavigationCategory["items"][number]
  }): unknown
  default(): unknown
}>()

const availableCategories = computed(() =>
  props.categories.filter(
    (category) => !category.disabled && category.items.some((item) => !item.disabled)
  )
)
const activeCategory = computed(
  () =>
    availableCategories.value.find((category) =>
      category.items.some((item) => item.id === model.value)
    ) ?? availableCategories.value[0]
)

function selectCategory(category: UiNavigationCategory): void {
  const first = category.items.find((item) => !item.disabled)
  if (first) model.value = first.id
}

function selectItem(item: UiNavigationCategory["items"][number]): void {
  if (!item.disabled) model.value = item.id
}
</script>

<template>
  <main class="ui-settings-navigator">
    <header class="ui-settings-navigator__topbar">
      <UiIconButton :label="props.backLabel" size="sm" variant="secondary" @click="emit('back')">
        <slot name="back-icon">←</slot>
      </UiIconButton>
      <div class="ui-settings-navigator__title">
        <span>{{ props.scopeLabel }}</span>
        <h1>{{ props.title }}</h1>
      </div>
      <div v-if="$slots.actions" class="ui-settings-navigator__actions">
        <slot name="actions" />
      </div>
    </header>

    <aside class="ui-settings-navigator__primary" :aria-label="props.categoriesLabel">
      <div class="ui-settings-navigator__label">
        {{ props.sidebarLabel ?? props.categoriesLabel }}
      </div>
      <nav class="ui-settings-navigator__primary-navigation" :aria-label="props.categoriesLabel">
        <button
          v-for="category in props.categories"
          :key="category.id"
          type="button"
          class="ui-settings-navigator__category"
          :class="{ 'is-active': category.id === activeCategory?.id }"
          :disabled="category.disabled || !category.items.some((item) => !item.disabled)"
          :aria-current="category.id === activeCategory?.id ? 'page' : undefined"
          @click="selectCategory(category)"
        >
          <span v-if="$slots['category-icon']" class="ui-settings-navigator__category-icon">
            <slot name="category-icon" :category="category" />
          </span>
          <span>{{ category.label }}</span>
          <small v-if="category.badge">{{ category.badge }}</small>
        </button>
      </nav>
      <div v-if="props.buildLabel" class="ui-settings-navigator__build">{{ props.buildLabel }}</div>
    </aside>

    <aside class="ui-settings-navigator__secondary" :aria-label="props.pagesLabel">
      <template v-if="activeCategory">
        <div class="ui-settings-navigator__heading">
          <span>{{ activeCategory.label }}</span>
          <strong>{{ activeCategory.description }}</strong>
        </div>
        <nav class="ui-settings-navigator__page-navigation" :aria-label="props.pagesLabel">
          <button
            v-for="item in activeCategory.items"
            :key="item.id"
            type="button"
            class="ui-settings-navigator__page"
            :class="{ 'is-active': item.id === model }"
            :disabled="item.disabled"
            :aria-current="item.id === model ? 'page' : undefined"
            @click="selectItem(item)"
          >
            <span v-if="$slots['item-icon']" class="ui-settings-navigator__page-icon">
              <slot name="item-icon" :category="activeCategory" :item="item" />
            </span>
            <span class="ui-settings-navigator__page-copy">
              <b>{{ item.label }}</b>
              <small v-if="item.description">{{ item.description }}</small>
            </span>
            <em v-if="item.badge">{{ item.badge }}</em>
          </button>
        </nav>
      </template>
    </aside>

    <slot />
  </main>
</template>

<style scoped>
.ui-settings-navigator {
  --ui-font-size-xs: var(--ui-type-size-control);
  --ui-font-size-sm: var(--ui-type-size-body-compact);
  --ui-font-size-md: var(--ui-type-size-label);
  --ui-color-canvas: var(--canvas);
  --ui-color-canvas-subtle: var(--surface-panel);
  --ui-color-surface: var(--surface-1);
  --ui-color-surface-sunken: var(--surface-sunken);
  --ui-color-surface-raised: var(--surface-2);
  --ui-color-surface-hover: var(--surface-3);
  --ui-color-surface-active: var(--daw-control-hover);
  --ui-color-control: var(--daw-control);
  --ui-color-control-hover: var(--daw-control-hover);
  --ui-color-control-pressed: var(--surface-sunken);
  --ui-color-text: var(--text-primary);
  --ui-color-text-muted: var(--text-secondary);
  --ui-color-text-subtle: var(--text-muted);
  --ui-color-border: var(--line-soft);
  --ui-color-border-strong: var(--line-strong);
  --settings-neutral-accent: var(--text-secondary);
  --settings-neutral-selection: var(--surface-2);
  --ui-color-action: var(--settings-neutral-accent);
  --ui-color-action-hover: var(--ui-color-text);
  --ui-color-action-pressed: var(--ui-color-text-muted);
  --ui-color-action-text: var(--ui-color-canvas);
  --ui-color-focus: var(--settings-neutral-accent);
  --ui-focus-ring: 0 0 0 3px color-mix(in srgb, var(--settings-neutral-accent) 38%, transparent);
  --focus-ring: var(--ui-focus-ring);
  --ui-shadow-selected-edge: 2px 0 0 var(--settings-neutral-accent) inset;
  --ui-shadow-selected-outline: 0 0 0 1px
    color-mix(in srgb, var(--settings-neutral-accent) 30%, transparent) inset;
  --ui-color-selection: var(--settings-neutral-selection);
  --ui-color-selection-hover: var(--ui-color-surface-hover);
  --ui-color-selection-border: var(--ui-color-border-strong);
  --accent: var(--settings-neutral-accent);
  --focus: var(--settings-neutral-accent);
  display: grid;
  width: 100%;
  height: 100%;
  grid-template-columns: 174px 194px minmax(0, 1fr);
  grid-template-rows: 60px minmax(0, 1fr);
  color: var(--ui-color-text);
  background: var(--ui-color-canvas);
}
.ui-settings-navigator__topbar {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: 2.25rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8125rem;
  padding: 0 1.125rem;
  border-bottom: 1px solid var(--ui-color-border-strong);
  background: var(--ui-color-surface);
  box-shadow: var(--ui-shadow-md);
}
.ui-settings-navigator__title span,
.ui-settings-navigator__label,
.ui-settings-navigator__heading span,
.ui-settings-navigator__build {
  color: var(--ui-color-text-subtle);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-widest);
  text-transform: uppercase;
}
.ui-settings-navigator__title h1 {
  margin: 0.1875rem 0 0;
  font-family: var(--ui-type-family-display);
  font-size: var(--ui-type-size-panel-title);
  font-weight: var(--ui-type-weight-semibold);
  letter-spacing: var(--ui-type-tracking-wide);
}
.ui-settings-navigator__title span,
.ui-settings-navigator__heading span {
  color: var(--ui-color-text-subtle);
}
.ui-settings-navigator__actions {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
}
.ui-settings-navigator__primary,
.ui-settings-navigator__secondary {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 1.5rem 0.6875rem;
  border-right: 1px solid var(--ui-color-border);
}
.ui-settings-navigator__primary {
  background: var(--ui-color-canvas-subtle);
}
.ui-settings-navigator__secondary {
  background: var(--ui-color-surface);
}
.ui-settings-navigator__primary-navigation {
  display: grid;
  gap: 0.1875rem;
  margin-top: 0.625rem;
}
.ui-settings-navigator__build {
  margin: var(--ui-space-5) var(--ui-space-2) 0;
}
.ui-settings-navigator__heading strong {
  display: block;
  margin-top: 0.375rem;
  color: var(--ui-color-text);
  font-family: var(--ui-type-family-display);
  font-size: var(--ui-type-size-section-title);
}
.ui-settings-navigator__category,
.ui-settings-navigator__page {
  width: 100%;
  border: 1px solid transparent;
  color: var(--ui-color-text-muted);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.ui-settings-navigator__category {
  display: grid;
  min-height: 2.125rem;
  grid-template-columns: 1.0625rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5625rem;
  border-radius: 0.375rem;
  font-size: var(--ui-type-size-body-compact);
}
.ui-settings-navigator__category.is-active {
  border-color: var(--ui-color-border-strong);
  color: var(--ui-color-text);
  background: var(--ui-color-selection);
  box-shadow: 2px 0 0 var(--settings-neutral-accent) inset;
}
.ui-settings-navigator__category-icon,
.ui-settings-navigator__page-icon {
  display: grid;
  place-items: center;
  color: var(--ui-color-text-muted);
}
.ui-settings-navigator__category-icon :deep(svg),
.ui-settings-navigator__page-icon :deep(svg) {
  width: 16px;
  height: 16px;
}
.ui-settings-navigator__category small,
.ui-settings-navigator__page em {
  color: var(--ui-color-text-subtle);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
  font-style: normal;
  letter-spacing: var(--ui-type-tracking-wide);
  text-transform: uppercase;
}
.ui-settings-navigator__heading {
  margin: 0 0.5625rem 1.0625rem;
}
.ui-settings-navigator__page-navigation {
  margin-top: 0;
}
.ui-settings-navigator__page {
  display: grid;
  grid-template-columns: 1.125rem minmax(0, 1fr) auto;
  gap: 0.5rem;
  margin-bottom: 0.3125rem;
  padding: 0.625rem;
  border-radius: 0.4375rem;
}
.ui-settings-navigator__page.is-active {
  border-color: var(--ui-color-border-strong);
  color: var(--ui-color-text);
  background: var(--ui-color-selection);
  box-shadow: inset 0 0 0 1px var(--settings-neutral-accent);
}
.ui-settings-navigator__page-copy b,
.ui-settings-navigator__page-copy small {
  display: block;
  min-width: 0;
}
.ui-settings-navigator__page-copy b {
  font-size: var(--ui-type-size-body-compact);
}
.ui-settings-navigator__page-copy small {
  margin-top: 0.25rem;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
  line-height: var(--ui-type-leading-compact);
}
.ui-settings-navigator__category:hover:not(:disabled),
.ui-settings-navigator__page:hover:not(:disabled) {
  color: var(--ui-color-text);
  background: var(--ui-color-surface-hover);
}
.ui-settings-navigator__category:focus-visible,
.ui-settings-navigator__page:focus-visible {
  outline: 2px solid var(--ui-color-focus);
  outline-offset: 2px;
}
.ui-settings-navigator__category:disabled,
.ui-settings-navigator__page:disabled {
  cursor: default;
  opacity: var(--ui-opacity-disabled);
}
@media (max-width: 1120px) {
  .ui-settings-navigator {
    grid-template-columns: 150px 174px minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .ui-settings-navigator {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto auto minmax(0, 1fr);
  }
  .ui-settings-navigator__topbar {
    min-height: 60px;
    padding: var(--ui-space-2);
  }
  .ui-settings-navigator__primary,
  .ui-settings-navigator__secondary {
    padding: var(--ui-space-2);
    border-right: 0;
  }
  .ui-settings-navigator__primary-navigation,
  .ui-settings-navigator__page-navigation {
    display: flex;
    overflow-x: auto;
  }
  .ui-settings-navigator__category,
  .ui-settings-navigator__page {
    width: auto;
    flex: 0 0 auto;
  }
  .ui-settings-navigator__build,
  .ui-settings-navigator__label,
  .ui-settings-navigator__heading {
    display: none;
  }
}
</style>
