<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { X } from "@lucide/vue"
import { UiIconButton, UiProvider, useLocaleFonts } from "@heron/ui"
import { usePluginAnalysis } from "../../composables/usePluginAnalysis"
import { useTheme } from "../../composables/useTheme"
import { setAppLocale } from "../../i18n"
import { rekaLocale } from "../../../../shared/i18n"
import AppTitleBar from "../application/AppTitleBar.vue"
import PluginAnalysisChain from "./PluginAnalysisChain.vue"
import PluginAnalysisCommandBar from "./PluginAnalysisCommandBar.vue"
import PluginAnalysisSettings from "./PluginAnalysisSettings.vue"
import PluginAnalysisReport from "./PluginAnalysisReport.vue"
import { useEqFitWindowSelection } from "./useEqFitWindowSelection"
const { t } = useI18n()
const { snapshot, error, catalogBusy, command, configure, platform } = usePluginAnalysis()
const eqFitWindow = useEqFitWindowSelection()
const locale = computed(() => snapshot.value?.locale ?? "en-US")
useLocaleFonts(locale)
useTheme(computed(() => snapshot.value?.theme ?? "dark"))
watch(locale, setAppLocale, { immediate: true })
const quarantined = computed(() => snapshot.value?.status === "quarantined")
const settingsOpen = ref(false)
watch(quarantined, (value) => {
  if (value) settingsOpen.value = false
})
// Closing the docked panel removes its focused close button; return focus to the
// control that opened it unless the user has already moved focus elsewhere.
let settingsTrigger: HTMLElement | null = null
watch(settingsOpen, async (open) => {
  if (open) {
    settingsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return
  }
  await nextTick()
  const active = document.activeElement
  if ((!active || active === document.body) && settingsTrigger?.isConnected) settingsTrigger.focus()
})
</script>
<template>
  <UiProvider :locale="rekaLocale(locale)"
    ><main class="plugin-analysis-app">
      <AppTitleBar
        class="analysis-titlebar"
        :platform="platform"
        :menus="[]"
        :project-name="t('pluginAnalysis.title')"
        :dirty="false"
        @window-command="
          command({
            type: 'window',
            action:
              $event === 'window.minimize'
                ? 'minimize'
                : $event === 'window.toggle-maximize'
                  ? 'maximize'
                  : 'close'
          })
        "
      />
      <template v-if="snapshot">
        <PluginAnalysisCommandBar
          :snapshot="snapshot"
          :settings-open="settingsOpen"
          @command="command"
          @configure="configure"
          @toggle-settings="settingsOpen = !settingsOpen"
        />
        <div class="workspace">
          <PluginAnalysisChain
            :snapshot="snapshot"
            :catalog-busy="catalogBusy"
            @command="command"
          />
          <section class="analysis">
            <p
              v-if="error || snapshot.failure || eqFitWindow.error.value"
              class="notice"
              role="alert"
            >
              {{
                error ||
                (snapshot.failure
                  ? t(`pluginAnalysis.failures.${snapshot.failure}`)
                  : t("pluginAnalysis.eqFit.openFailed"))
              }}
            </p>
            <PluginAnalysisReport
              :snapshot="snapshot"
              @eq-fit-selection="eqFitWindow.select"
              @open-eq-fit="eqFitWindow.open"
            />
          </section>
          <aside
            v-if="settingsOpen"
            id="plugin-analysis-settings"
            class="settings-panel"
            :aria-label="t('pluginAnalysis.measurementSettings')"
          >
            <header class="settings-heading">
              <h2>{{ t("pluginAnalysis.measurementSettings") }}</h2>
              <UiIconButton
                :label="t('pluginAnalysis.closeSettings')"
                size="sm"
                variant="ghost"
                @click="settingsOpen = false"
                ><X :size="14"
              /></UiIconButton>
            </header>
            <PluginAnalysisSettings :settings="snapshot.settings" @configure="configure" />
          </aside>
        </div>
      </template>
      <p v-else class="loading" role="status">{{ t("pluginAnalysis.loading") }}</p>
    </main></UiProvider
  >
</template>
<style scoped>
/* The window is a standalone instrument, so dense roles read at panel size.
   The insert rack keeps Mixer density and is deliberately excluded. */
.plugin-analysis-command-bar,
.analysis,
.settings-panel {
  --ui-type-size-control: var(--ui-type-size-section-title);
  --ui-type-size-caption: var(--ui-type-size-label);
  --ui-type-size-micro: var(--ui-type-size-label);
}
.plugin-analysis-app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  color: var(--ui-color-text);
  background: var(--ui-color-canvas);
}
.analysis-titlebar {
  flex-shrink: 0;
}
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
}
.analysis {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}
.notice {
  margin: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--ui-color-border);
  border-left: 3px solid var(--ui-color-danger);
  color: var(--ui-color-text);
  background: color-mix(in srgb, var(--ui-color-danger) 10%, var(--ui-color-surface));
  font-size: var(--ui-type-size-caption);
}
.settings-panel {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 320px;
  min-height: 0;
  overflow-y: auto;
  border-left: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface);
}
.settings-heading {
  position: sticky;
  top: 0;
  z-index: var(--ui-z-local-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface);
}
.settings-heading h2 {
  margin: 0;
  font-size: var(--ui-type-size-panel-title);
  font-weight: var(--ui-type-weight-semibold);
}
.loading {
  padding: 40px;
  color: var(--ui-color-text-muted);
}
</style>
