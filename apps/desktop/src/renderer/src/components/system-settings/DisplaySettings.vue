<script setup lang="ts">
import { computed, onMounted } from "vue"
import { storeToRefs } from "pinia"
import { useI18n } from "vue-i18n"
import { Languages, Monitor, Moon, Sun } from "@lucide/vue"
import { UiCheckbox, UiChoiceCard } from "@heron/ui"
import type { Component } from "vue"
import type { AppLocale, ThemePreference } from "@heron/contracts"
import SettingsPage from "../settings/SettingsPage.vue"
import SettingsSection from "../settings/SettingsSection.vue"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { APP_LOCALES } from "../../../../shared/i18n"

const { t } = useI18n()
const settingsStore = useApplicationSettingsStore()
const { settings, loading, error } = storeToRefs(settingsStore)

const themeOptions = computed<
  ReadonlyArray<{
    value: ThemePreference
    label: string
    description: string
    icon: Component
  }>
>(() => [
  {
    value: "light",
    label: t("settings.display.theme.light.label"),
    description: t("settings.display.theme.light.description"),
    icon: Sun
  },
  {
    value: "dark",
    label: t("settings.display.theme.dark.label"),
    description: t("settings.display.theme.dark.description"),
    icon: Moon
  },
  {
    value: "system",
    label: t("settings.display.theme.system.label"),
    description: t("settings.display.theme.system.description"),
    icon: Monitor
  }
])

const localeOptions = computed<
  ReadonlyArray<{
    value: AppLocale
    label: string
    description: string
  }>
>(() =>
  APP_LOCALES.map((locale) => ({
    value: locale,
    label: t(`settings.display.locales.${locale}.label`),
    description: t(`settings.display.locales.${locale}.description`)
  }))
)

onMounted(() => {
  if (!settings.value) void settingsStore.load()
})
</script>

<template>
  <SettingsPage
    :category="t('settings.display.category')"
    :page="t('settings.display.page')"
    :title="t('settings.display.title')"
    :description="t('settings.display.description')"
  >
    <SettingsSection
      :title="t('settings.display.themeTitle')"
      :description="t('settings.display.themeDescription')"
    >
      <div class="theme-options" :aria-label="t('settings.display.themeAria')">
        <UiChoiceCard
          v-for="option in themeOptions"
          :key="option.value"
          :label="option.label"
          :description="option.description"
          :selected="settings?.theme === option.value"
          :disabled="loading"
          @select="settingsStore.setTheme(option.value)"
        >
          <template #preview
            ><span
              class="theme-preview"
              :class="`theme-preview-${option.value}`"
              aria-hidden="true"
            >
              <span class="preview-sidebar" />
              <span class="preview-content"><i /><i /><i /></span> </span
          ></template>
          <template #icon><component :is="option.icon" :size="14" aria-hidden="true" /></template>
        </UiChoiceCard>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.display.languageTitle')"
      :description="t('settings.display.languageDescription')"
    >
      <div
        class="locale-options"
        role="radiogroup"
        :aria-label="t('settings.display.languageAria')"
      >
        <UiChoiceCard
          v-for="option in localeOptions"
          :key="option.value"
          :label="option.label"
          :description="option.description"
          :selected="settings?.locale === option.value"
          :disabled="loading"
          @select="settingsStore.setLocale(option.value)"
        >
          <template #icon><Languages :size="14" aria-hidden="true" /></template>
        </UiChoiceCard>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.display.tutorialsTitle')"
      :description="t('settings.display.tutorialsDescription')"
    >
      <UiCheckbox
        :model-value="settings?.tutorials.autoStart ?? true"
        :label="t('settings.display.tutorialsAutoStart')"
        :description="t('settings.display.tutorialsAutoStartDescription')"
        :disabled="loading"
        @update:model-value="settingsStore.setTutorialAutoStart"
      />
    </SettingsSection>

    <p v-if="error" class="display-error" role="alert">{{ error }}</p>
  </SettingsPage>
</template>

<style scoped>
.theme-options,
.locale-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.locale-options {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.theme-preview {
  display: grid;
  grid-template-columns: 25% 1fr;
  height: 72px;
  border: 1px solid color-mix(in srgb, var(--ui-color-text) 18%, transparent);
  border-radius: 5px;
  background: var(--ui-color-canvas);
  overflow: hidden;
}

.preview-sidebar {
  background: var(--ui-color-surface-sunken);
}

.preview-content {
  display: grid;
  align-content: center;
  gap: 6px;
  padding: 11px;
}

.preview-content i {
  display: block;
  height: 5px;
  border-radius: 2px;
  background: var(--ui-color-border-strong);
}

.preview-content i:first-child {
  width: 58%;
  background: var(--ui-color-action);
}

.preview-content i:last-child {
  width: 75%;
}

.theme-preview-light {
  --canvas: var(--ui-domain-preview-light-canvas);
  --surface-panel: var(--ui-domain-preview-light-panel);
  --line-strong: var(--ui-domain-preview-light-line);
  --accent: var(--ui-domain-preview-light-accent);
}

.theme-preview-dark {
  --canvas: var(--ui-domain-preview-dark-canvas);
  --surface-panel: var(--ui-domain-preview-dark-panel);
  --line-strong: var(--ui-domain-preview-dark-line);
  --accent: var(--ui-domain-preview-dark-accent);
}

.theme-preview-system {
  background: linear-gradient(
    90deg,
    var(--ui-domain-preview-light-canvas) 0 50%,
    var(--ui-domain-preview-dark-canvas) 50%
  );
}

.theme-preview-system .preview-sidebar {
  background: linear-gradient(
    90deg,
    var(--ui-domain-preview-light-panel) 0 50%,
    var(--ui-domain-preview-dark-panel) 50%
  );
}

.theme-preview-system .preview-content i {
  background: linear-gradient(
    90deg,
    var(--ui-domain-preview-light-line) 0 50%,
    var(--ui-domain-preview-dark-line) 50%
  );
}

.theme-preview-system .preview-content i:first-child {
  background: linear-gradient(
    90deg,
    var(--ui-domain-preview-light-accent) 0 50%,
    var(--ui-domain-preview-dark-accent) 50%
  );
}

.display-error {
  color: var(--ui-signal-record);
  font-size: var(--ui-type-size-body-compact);
}

@media (max-width: 1120px) {
  .theme-options {
    grid-template-columns: repeat(auto-fit, minmax(min(120px, 100%), 1fr));
  }

  .locale-options {
    grid-template-columns: 1fr;
  }
}
</style>
