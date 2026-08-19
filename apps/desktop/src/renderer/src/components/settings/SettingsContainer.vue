<script setup lang="ts">
import { computed, watch } from "vue"
import { ArrowLeft } from "@lucide/vue"
import { useI18n } from "vue-i18n"
import { UiSettingsNavigator, type UiNavigationCategory } from "@heron/ui"
import type { SettingsCategory } from "./settings"

const props = defineProps<{
  title: string
  scopeLabel: string
  backLabel: string
  categories: readonly SettingsCategory[]
  activePage: string
}>()
const emit = defineEmits<{ back: []; "update:activePage": [page: string] }>()
defineSlots<{ actions(): unknown; default(): unknown }>()

const { t } = useI18n()
const appVersion = __APP_VERSION__
const navigation = computed<readonly UiNavigationCategory[]>(() =>
  props.categories.map((category) => ({
    id: category.id,
    label: category.label,
    description: category.description,
    badge: category.badge,
    disabled: category.disabled,
    items: category.pages.map((page) => ({
      id: page.id,
      label: page.label,
      description: page.description,
      badge: page.badge,
      disabled: page.disabled
    }))
  }))
)
const firstAvailablePage = computed(() =>
  navigation.value
    .flatMap((category) => (category.disabled ? [] : category.items))
    .find((page) => !page.disabled)
)

function categoryIcon(categoryId: string) {
  return props.categories.find((category) => category.id === categoryId)?.icon
}

function pageIcon(categoryId: string, pageId: string) {
  return props.categories
    .find((category) => category.id === categoryId)
    ?.pages.find((page) => page.id === pageId)?.icon
}

watch(
  () => [props.activePage, navigation.value] as const,
  () => {
    const valid = navigation.value.some(
      (category) =>
        !category.disabled &&
        category.items.some((page) => page.id === props.activePage && !page.disabled)
    )
    if (!valid && firstAvailablePage.value) emit("update:activePage", firstAvailablePage.value.id)
  },
  { immediate: true }
)
</script>

<template>
  <UiSettingsNavigator
    :model-value="activePage"
    :title="title"
    :scope-label="scopeLabel"
    :back-label="backLabel"
    :categories-label="t('chrome.categoriesAria', { title })"
    :pages-label="t('chrome.pagesAria', { category: title })"
    :sidebar-label="t('chrome.settings')"
    :categories="navigation"
    :build-label="t('chrome.buildLabel', { version: appVersion })"
    @back="emit('back')"
    @update:model-value="emit('update:activePage', $event)"
  >
    <template #back-icon><ArrowLeft :size="16" /></template>
    <template #category-icon="{ category }">
      <component :is="categoryIcon(category.id)" :size="15" />
    </template>
    <template #item-icon="{ category, item }">
      <component :is="pageIcon(category.id, item.id)" :size="15" />
    </template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <slot />
  </UiSettingsNavigator>
</template>
