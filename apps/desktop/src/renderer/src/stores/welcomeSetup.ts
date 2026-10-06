import { acceptHMRUpdate, defineStore } from "pinia"
import { computed, shallowRef } from "vue"
import type { AppLocale, ThemePreference } from "@heron/contracts"
import { useApplicationSettingsStore } from "./applicationSettings"
import { useProjectStore } from "./project"
import { useLiveStore } from "./live"
import { useStudioWorkflowStore } from "./studioWorkflow"
import { mutationMeta } from "../rpc"

/** Draft choices preview locally; consent becomes durable only on explicit save. */
export const useWelcomeSetupStore = defineStore("welcome-setup", () => {
  const settingsStore = useApplicationSettingsStore()
  const selectedTheme = shallowRef<ThemePreference | null>(null)
  const selectedLocale = shallowRef<AppLocale | null>(null)
  const selectedDiagnostics = shallowRef<boolean | null>(null)
  const saving = shallowRef(false)
  const savedForRestart = shallowRef(false)
  const restartStatus = shallowRef<"idle" | "restarting" | "cancelled" | "blocked" | "failed">(
    "idle"
  )
  const required = computed(
    () => saving.value || savedForRestart.value || settingsStore.settings?.welcomeCompleted !== true
  )
  const theme = computed(() => selectedTheme.value ?? settingsStore.settings?.theme ?? "system")
  const locale = computed(() => selectedLocale.value ?? settingsStore.settings?.locale ?? "en-US")
  const diagnosticsEnabled = computed(
    () => selectedDiagnostics.value ?? settingsStore.settings?.diagnosticsEnabled ?? false
  )

  async function attemptRestart(): Promise<void> {
    try {
      // Reuse the normal close workflows, including pending edits and save/cancel.
      const live = useLiveStore()
      if (live.isOpen && !(await live.close())) {
        restartStatus.value = "cancelled"
        return
      }
      if (useProjectStore().session && !(await useStudioWorkflowStore().closeProject())) {
        restartStatus.value = "cancelled"
        return
      }
      const target = settingsStore.desktopSession
      if (!target) {
        restartStatus.value = "failed"
        return
      }
      const result = await window.heron.restartApplication(mutationMeta(target, "welcome-restart"))
      restartStatus.value = result.ok ? result.value.status : "failed"
    } catch {
      restartStatus.value = "failed"
    }
  }

  async function complete(): Promise<void> {
    if (saving.value || savedForRestart.value || !settingsStore.settings) return
    saving.value = true
    const restart = diagnosticsEnabled.value
    try {
      const saved = await settingsStore.saveWelcomePreferences({
        theme: theme.value,
        locale: locale.value,
        diagnosticsEnabled: diagnosticsEnabled.value
      })
      if (saved) {
        savedForRestart.value = restart
        selectedTheme.value = null
        selectedLocale.value = null
        selectedDiagnostics.value = null
        if (restart) await attemptRestart()
      }
    } finally {
      saving.value = false
    }
  }

  async function retryRestart(): Promise<void> {
    if (saving.value || !savedForRestart.value || restartStatus.value === "restarting") return
    saving.value = true
    try {
      await attemptRestart()
    } finally {
      saving.value = false
    }
  }

  function continueLater(): void {
    if (saving.value || restartStatus.value === "restarting") return
    savedForRestart.value = false
    restartStatus.value = "idle"
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
    savedForRestart,
    restartStatus,
    complete,
    retryRestart,
    continueLater
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useWelcomeSetupStore, import.meta.hot))
}
