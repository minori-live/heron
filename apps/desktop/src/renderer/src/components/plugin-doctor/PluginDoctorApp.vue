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
import { usePluginDoctor } from "../../composables/usePluginDoctor"
import { useTheme } from "../../composables/useTheme"
import { setAppLocale } from "../../i18n"
import { rekaLocale } from "../../../../shared/i18n"
import AppTitleBar from "../application/AppTitleBar.vue"
import DoctorChain from "./DoctorChain.vue"
import DoctorSettings from "./DoctorSettings.vue"
import DoctorReport from "./DoctorReport.vue"
const { t } = useI18n()
const { snapshot, error, catalogBusy, command, configure, platform } = usePluginDoctor()
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
</script>
<template>
  <UiProvider :locale="rekaLocale(locale)"
    ><main class="doctor-app">
      <AppTitleBar
        class="analysis-titlebar"
        :platform="platform"
        :menus="[]"
        :project-name="t('doctor.title')"
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
        <DoctorChain :snapshot="snapshot" :catalog-busy="catalogBusy" @command="command" />
        <section class="analysis">
          <div class="analysis-heading">
            <span class="conditions"
              >{{ snapshot.settings.sample_rate / 1000 }} kHz · {{ snapshot.settings.block_size }}
              {{ t("doctor.samples") }}</span
            ><UiPopover align="end"
              ><template #trigger
                ><UiIconButton
                  :label="t('doctor.measurementSettings')"
                  size="sm"
                  variant="ghost"
                  :disabled="quarantined"
                  ><Settings2 :size="15" /></UiIconButton></template
              ><DoctorSettings :settings="snapshot.settings" @configure="configure"
            /></UiPopover>
          </div>
          <p v-if="error || snapshot.failure" class="error" role="alert">
            {{ error || t(`doctor.failures.${snapshot.failure}`) }}
          </p>
          <p v-if="snapshot.report && snapshot.reportRevision !== snapshot.revision" class="stale">
            {{ t("doctor.stale") }}
          </p>
          <DoctorReport :snapshot="snapshot" />
          <footer class="measurement-controls" :inert="quarantined || undefined">
            <div class="input-level">
              <span>{{ t("doctor.level") }}</span
              ><UiSlider
                id="doctor-input-level"
                v-model="inputLevel"
                :min="-60"
                :max="12"
                :step="0.5"
                :label="t('doctor.level')"
                :value-text="inputLevelText"
                @change="configure({ level_dbfs: inputLevel })"
              /><output for="doctor-input-level">{{ inputLevelText }}</output>
            </div>
            <UiCheckbox
              :model-value="snapshot.automatic"
              :label="t('doctor.automatic')"
              @update:model-value="command({ type: 'automatic', enabled: $event })"
            />
            <div class="measurement-actions">
              <UiButton
                v-if="running"
                size="sm"
                variant="secondary"
                @click="command({ type: 'cancel' })"
                >{{ t("doctor.cancel") }}</UiButton
              ><UiButton size="sm" @click="command({ type: 'analyze' })">{{
                t("doctor.analyze")
              }}</UiButton>
            </div>
          </footer>
        </section>
      </div>
      <p v-else class="loading" role="status">{{ t("doctor.loading") }}</p>
    </main></UiProvider
  >
</template>
<style scoped>
.doctor-app {
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
