<script setup lang="ts">
import { onMounted, shallowRef } from "vue"
import { storeToRefs } from "pinia"
import { useI18n } from "vue-i18n"
import { UiCheckbox } from "@heron/ui"
import SettingsPage from "../settings/SettingsPage.vue"
import SettingsSection from "../settings/SettingsSection.vue"
import AppearanceOptions from "./AppearanceOptions.vue"
import DiagnosticsConsent from "./DiagnosticsConsent.vue"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"

const { t } = useI18n()
const settingsStore = useApplicationSettingsStore()
const { settings, loading, error } = storeToRefs(settingsStore)
const savingDiagnostics = shallowRef(false)
const diagnosticsDraft = shallowRef<boolean | null>(null)

async function setDiagnosticsEnabled(value: boolean): Promise<void> {
  if (savingDiagnostics.value) return
  diagnosticsDraft.value = value
  savingDiagnostics.value = true
  try {
    await settingsStore.setDiagnosticsEnabled(value)
  } finally {
    diagnosticsDraft.value = null
    savingDiagnostics.value = false
  }
}

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
    <AppearanceOptions
      :theme="settings?.theme ?? 'system'"
      :locale="settings?.locale ?? 'en-US'"
      :disabled="loading || !settings"
      @theme="settingsStore.setTheme"
      @locale="settingsStore.setLocale"
    />
    <DiagnosticsConsent
      :model-value="diagnosticsDraft ?? settings?.diagnosticsEnabled ?? false"
      :disabled="loading || !settings || savingDiagnostics"
      @update:model-value="setDiagnosticsEnabled"
    />
    <SettingsSection
      :title="t('settings.display.tutorialsTitle')"
      :description="t('settings.display.tutorialsDescription')"
    >
      <UiCheckbox
        :model-value="settings?.tutorials.autoStart ?? true"
        :label="t('settings.display.tutorialsAutoStart')"
        :description="t('settings.display.tutorialsAutoStartDescription')"
        :disabled="loading || !settings"
        @update:model-value="settingsStore.setTutorialAutoStart"
      />
    </SettingsSection>
    <p v-if="error" class="display-error" role="alert">{{ error }}</p>
  </SettingsPage>
</template>

<style scoped>
.display-error {
  color: var(--ui-signal-record);
  font-size: var(--ui-type-size-body-compact);
}
</style>
