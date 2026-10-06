import { acceptHMRUpdate, defineStore } from "pinia"
import { computed, shallowRef } from "vue"
import type { AppLocale, ThemePreference } from "@heron/contracts"
import { useApplicationSettingsStore } from "./applicationSettings"

/** Draft choices preview locally; consent becomes durable only on Continue. */
export const useWelcomeSetupStore = defineStore("welcome-setup", () => {
  const settingsStore = useApplicationSettingsStore()
  const selectedTheme = shallowRef<ThemePreference | null>(null)
  const selectedLocale = shallowRef<AppLocale | null>(null)
  const selectedDiagnostics = shallowRef<boolean | null>(null)
  const saving = shallowRef(false)
  const required = computed(() => settingsStore.settings?.welcomeCompleted !== true)
  const theme = computed(() => selectedTheme.value ?? settingsStore.settings?.theme ?? "system")
  const locale = computed(() => selectedLocale.value ?? settingsStore.settings?.locale ?? "en-US")
  const diagnosticsEnabled = computed(
    () => selectedDiagnostics.value ?? settingsStore.settings?.diagnosticsEnabled ?? false
  )

  async function complete(): Promise<void> {
    if (saving.value || !settingsStore.settings) return
    saving.value = true
    try {
      const saved = await settingsStore.saveWelcomePreferences({
        theme: theme.value,
        locale: locale.value,
        diagnosticsEnabled: diagnosticsEnabled.value
      })
      if (saved) {
        selectedTheme.value = null
        selectedLocale.value = null
        selectedDiagnostics.value = null
      }
    } finally {
      saving.value = false
    }
  }

  return {
    selectedTheme,
    selectedLocale,
    selectedDiagnostics,
    required,
    theme,
    locale,
    diagnosticsEnabled,
    saving,
    complete
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useWelcomeSetupStore, import.meta.hot))
}
