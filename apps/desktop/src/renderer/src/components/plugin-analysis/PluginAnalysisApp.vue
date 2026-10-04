<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { Settings2 } from "@lucide/vue"
import {
  UiButton,
  UiCheckbox,
  UiIconButton,
  UiPopover,
  UiProvider,
  UiSlider,
  useLocaleFonts
} from "@heron/ui"
import { usePluginAnalysis } from "../../composables/usePluginAnalysis"
import { useTheme } from "../../composables/useTheme"
import { setAppLocale } from "../../i18n"
import { rekaLocale } from "../../../../shared/i18n"
import AppTitleBar from "../application/AppTitleBar.vue"
import PluginAnalysisChain from "./PluginAnalysisChain.vue"
import PluginAnalysisSettings from "./PluginAnalysisSettings.vue"
import PluginAnalysisReport from "./PluginAnalysisReport.vue"
const { t } = useI18n()
const { snapshot, error, catalogBusy, command, configure, platform } = usePluginAnalysis()
const locale = computed(() => snapshot.value?.locale ?? "en-US")
useLocaleFonts(locale)
useTheme(computed(() => snapshot.value?.theme ?? "dark"))
watch(locale, setAppLocale, { immediate: true })
const quarantined = computed(() => snapshot.value?.status === "quarantined")
const running = computed(
  () => snapshot.value?.status === "running" || snapshot.value?.status === "debouncing"
)
const inputLevel = ref(-18)
watch(
  () => snapshot.value?.settings.level_dbfs,
  (value) => {
    if (value !== undefined) inputLevel.value = value
  },
  { immediate: true }
)
const inputLevelText = computed(
  () => `${inputLevel.value > 0 ? "+" : ""}${inputLevel.value.toFixed(1)} dBFS`
)
const conditions = computed(() =>
  t("pluginAnalysis.conditions", {
    rate: (snapshot.value?.settings.sample_rate ?? 0) / 1000,
    block: snapshot.value?.settings.block_size ?? 0,
    samples: t("pluginAnalysis.samples")
  })
)
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
      <div v-if="snapshot" class="workspace">
        <PluginAnalysisChain :snapshot="snapshot" :catalog-busy="catalogBusy" @command="command" />
        <section class="analysis">
          <div class="analysis-heading">
            <span class="conditions">{{ conditions }}</span
            ><UiPopover align="end"
              ><template #trigger
                ><UiIconButton
                  :label="t('pluginAnalysis.measurementSettings')"
                  size="sm"
                  variant="ghost"
                  :disabled="quarantined"
                  ><Settings2 :size="15" /></UiIconButton></template
              ><PluginAnalysisSettings :settings="snapshot.settings" @configure="configure"
            /></UiPopover>
          </div>
          <p v-if="error || snapshot.failure" class="error" role="alert">
            {{ error || t(`pluginAnalysis.failures.${snapshot.failure}`) }}
          </p>
          <p v-if="snapshot.report && snapshot.reportRevision !== snapshot.revision" class="stale">
            {{ t("pluginAnalysis.stale") }}
          </p>
          <PluginAnalysisReport :snapshot="snapshot" />
          <footer class="measurement-controls" :inert="quarantined || undefined">
            <div class="input-level">
              <span>{{ t("pluginAnalysis.level") }}</span
              ><UiSlider
                id="plugin-analysis-input-level"
                v-model="inputLevel"
                :min="-60"
                :max="12"
                :step="0.5"
                :label="t('pluginAnalysis.level')"
                :value-text="inputLevelText"
                @change="configure({ level_dbfs: inputLevel })"
              /><output for="plugin-analysis-input-level">{{ inputLevelText }}</output>
            </div>
            <UiCheckbox
              :model-value="snapshot.automatic"
              :label="t('pluginAnalysis.automatic')"
              @update:model-value="command({ type: 'automatic', enabled: $event })"
            />
            <div class="measurement-actions">
              <UiButton
                v-if="running"
                size="sm"
                variant="secondary"
                @click="command({ type: 'cancel' })"
                >{{ t("pluginAnalysis.cancel") }}</UiButton
              ><UiButton size="sm" @click="command({ type: 'analyze' })">{{
                t("pluginAnalysis.analyze")
              }}</UiButton>
            </div>
          </footer>
        </section>
      </div>
      <p v-else class="loading" role="status">{{ t("pluginAnalysis.loading") }}</p>
    </main></UiProvider
  >
</template>
<style scoped>
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
  --ui-type-size-control: var(--ui-type-size-section-title);
  --ui-type-size-caption: var(--ui-type-size-label);
  --ui-type-size-micro: var(--ui-type-size-label);
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}
.analysis-heading {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 14px;
  min-height: 44px;
  padding: 0 14px 0 20px;
  border-bottom: 1px solid var(--ui-color-border);
}
.conditions {
  color: var(--ui-color-text-subtle);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}
.measurement-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 10px 14px;
  border-top: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-sunken);
  font-size: var(--ui-type-size-caption);
}
.input-level {
  display: grid;
  grid-template-columns: minmax(100px, 160px) auto;
  align-items: center;
  column-gap: 10px;
  flex: 0 1 240px;
  min-width: 200px;
}
.input-level > span {
  grid-column: 1 / -1;
}
.input-level output {
  min-width: 72px;
  font-family: var(--ui-type-family-data);
  text-align: right;
}
.measurement-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.error,
.stale {
  margin: 0;
  padding: 8px 16px;
  font-size: var(--ui-type-size-caption);
  border-bottom: 1px solid var(--ui-color-border);
}
.error {
  color: var(--ui-color-danger);
}
.stale,
.loading {
  color: var(--ui-color-text-muted);
}
.loading {
  padding: 40px;
}
</style>
