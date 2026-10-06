<script setup lang="ts">
import { shallowRef, computed, watch } from "vue"
import type { AppLocale } from "@heron/contracts"
import { useI18n } from "vue-i18n"
import { UiButton, UiProvider, useLocaleFonts } from "@heron/ui"
import { useTheme } from "../../composables/useTheme"
import { setAppLocale } from "../../i18n"
import { rekaLocale } from "../../../../shared/i18n"
import AppTitleBar from "../application/AppTitleBar.vue"
import PluginAnalysisEqFit from "./PluginAnalysisEqFit.vue"
import { useEqFitWindow } from "./useEqFitWindow"

const { t } = useI18n()
const { snapshot, error, windowError, platform, windowCommand, refresh } = useEqFitWindow()
const locale = shallowRef<AppLocale>("en-US")
const theme = shallowRef<"light" | "dark">("dark")
watch(snapshot, (value) => {
  if (value) {
    locale.value = value.locale
    theme.value = value.theme
  }
})
useLocaleFonts(locale)
useTheme(theme)
watch(locale, setAppLocale, { immediate: true })
const available = computed(() => {
  const value = snapshot.value
  return (
    !!value?.selection &&
    !!value.report &&
    value.selection.reportId === value.reportId &&
    value.selection.reportRevision === value.reportRevision &&
    value.reportRevision === value.revision
  )
})
</script>

<template>
  <UiProvider :locale="rekaLocale(locale)">
    <main class="eq-fit-app">
      <AppTitleBar
        class="fit-titlebar"
        :platform="platform"
        :menus="[]"
        :project-name="t('pluginAnalysis.eqFit.title')"
        :dirty="false"
        @window-command="windowCommand"
      />
      <div class="fit-workspace">
        <p v-if="windowError" class="fit-message" role="alert">
          {{ t("pluginAnalysis.eqFit.windowActionFailed") }}
        </p>
        <div v-if="error" class="fit-message" role="alert">
          <p>{{ t("pluginAnalysis.eqFit.windowUnavailable") }}</p>
          <UiButton size="sm" variant="secondary" @click="refresh">{{
            t("pluginAnalysis.eqFit.retry")
          }}</UiButton>
        </div>
        <PluginAnalysisEqFit
          v-if="available && snapshot?.selection && snapshot.report"
          :report="snapshot.report"
          :comparison="snapshot.comparisonReport ?? undefined"
          :input="snapshot.selection.input"
          :output="snapshot.selection.output"
          :mode="snapshot.selection.mode"
          :report-id="snapshot.reportId"
          :report-revision="snapshot.reportRevision"
          :revision="snapshot.revision"
          :selection-revision="snapshot.selectionRevision"
        />
        <p v-else-if="!error" class="fit-message" role="status">
          {{ t(snapshot ? "pluginAnalysis.eqFit.contextUnavailable" : "pluginAnalysis.loading") }}
        </p>
      </div>
    </main>
  </UiProvider>
</template>

<style scoped>
.eq-fit-app {
  --ui-type-size-control: var(--ui-type-size-section-title);
  --ui-type-size-caption: var(--ui-type-size-label);
  --ui-type-size-micro: var(--ui-type-size-label);
  display: flex;
  flex-direction: column;
  height: 100dvh;
  color: var(--ui-color-text);
  background: var(--ui-color-canvas);
}
.fit-titlebar {
  flex-shrink: 0;
}
.fit-workspace {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.fit-message {
  margin: 0;
  padding: 20px;
  font-size: var(--ui-type-size-control);
  color: var(--ui-color-text-muted);
}
</style>
