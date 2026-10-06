<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useWelcomeSetupStore } from "../../stores/welcomeSetup"
import WelcomeSetupPage from "./WelcomeSetupPage.vue"

const settingsStore = useApplicationSettingsStore()
const welcomeStore = useWelcomeSetupStore()
const { settings, loading, error } = storeToRefs(settingsStore)
const { theme, locale, diagnosticsEnabled, saving, savedForRestart, restartStatus } =
  storeToRefs(welcomeStore)
</script>

<template>
  <WelcomeSetupPage
    :theme="theme"
    :locale="locale"
    :diagnostics-enabled="diagnosticsEnabled"
    :saving="saving"
    :saved-for-restart="savedForRestart"
    :restart-status="restartStatus"
    :loading="loading"
    :available="!!settings"
    :error="error"
    @theme="welcomeStore.selectedTheme = $event"
    @locale="welcomeStore.selectedLocale = $event"
    @diagnostics="welcomeStore.selectedDiagnostics = $event"
    @continue="welcomeStore.complete"
    @retry="settingsStore.load"
    @restart="welcomeStore.retryRestart"
    @later="welcomeStore.continueLater"
  />
</template>
