<script setup lang="ts">
import type { AppLocale, ThemePreference } from "@heron/contracts"
import { HeronLogo, UiButton } from "@heron/ui"
import { useI18n } from "vue-i18n"
import AppearanceOptions from "../system-settings/AppearanceOptions.vue"
import DiagnosticsConsent from "../system-settings/DiagnosticsConsent.vue"

const props = defineProps<{
  theme: ThemePreference
  locale: AppLocale
  diagnosticsEnabled: boolean
  saving: boolean
  savedForRestart: boolean
  restartStatus: "idle" | "restarting" | "cancelled" | "blocked" | "failed"
  loading: boolean
  available: boolean
  error: string
}>()
const emit = defineEmits<{
  theme: [value: ThemePreference]
  locale: [value: AppLocale]
  diagnostics: [value: boolean]
  continue: []
  retry: []
  restart: []
  later: []
}>()
const { t } = useI18n()
</script>

<template>
  <main class="welcome-setup">
    <div class="welcome-setup__content">
      <header class="welcome-setup__header">
        <HeronLogo :size="44" />
        <div>
          <h1>{{ t("onboarding.title") }}</h1>
          <p>{{ t("onboarding.description") }}</p>
        </div>
      </header>
      <AppearanceOptions
        :theme="props.theme"
        :locale="props.locale"
        :disabled="props.saving || props.savedForRestart || props.loading || !props.available"
        stacked
        @theme="emit('theme', $event)"
        @locale="emit('locale', $event)"
      />
      <DiagnosticsConsent
        :model-value="props.diagnosticsEnabled"
        :disabled="props.saving || props.savedForRestart || props.loading || !props.available"
        stacked
        @update:model-value="emit('diagnostics', $event)"
      />
      <footer class="welcome-setup__footer">
        <div class="welcome-setup__status" aria-live="polite">
          <p v-if="props.savedForRestart">
            {{
              t(
                props.restartStatus === "restarting" || props.saving
                  ? "onboarding.restarting"
                  : "onboarding.restartDeferred"
              )
            }}
          </p>
          <p v-else-if="props.error" role="alert">
            {{ t(props.available ? "onboarding.saveError" : "onboarding.loadError") }}
          </p>
          <p v-else>{{ t("onboarding.changeLater") }}</p>
        </div>
        <UiButton v-if="!props.available" :disabled="props.loading" @click="emit('retry')">{{
          t("onboarding.retry")
        }}</UiButton>
        <template v-else-if="props.savedForRestart">
          <UiButton
            :disabled="props.saving || props.restartStatus === 'restarting'"
            @click="emit('later')"
            >{{ t("onboarding.restartLater") }}</UiButton
          >
          <UiButton
            variant="primary"
            :disabled="props.saving || props.restartStatus === 'restarting'"
            :aria-busy="props.saving || props.restartStatus === 'restarting'"
            @click="emit('restart')"
            >{{ t("onboarding.retryRestart") }}</UiButton
          >
        </template>
        <UiButton
          v-else
          variant="primary"
          :disabled="props.saving || props.loading"
          :aria-busy="props.saving"
          @click="emit('continue')"
          >{{
            t(props.diagnosticsEnabled ? "onboarding.saveAndRestart" : "onboarding.continue")
          }}</UiButton
        >
      </footer>
    </div>
  </main>
</template>

<style scoped>
.welcome-setup {
  height: 100%;
  overflow: auto;
  padding: clamp(20px, 5vw, 64px);
  background: var(--ui-color-canvas);
  color: var(--ui-color-text);
}

.welcome-setup__content {
  width: 100%;
  max-width: 680px;
  margin-inline: auto;
}

.welcome-setup__header {
  display: flex;
  align-items: center;
  gap: var(--ui-space-4);
  padding-bottom: var(--ui-space-5);
  border-bottom: 2px solid var(--ui-color-action);
}

.welcome-setup__header h1 {
  margin: 0;
  font-family: var(--ui-type-family-display);
  font-size: var(--ui-type-size-page-title);
  font-weight: var(--ui-type-weight-semibold);
}

.welcome-setup__header p,
.welcome-setup__status p {
  margin: var(--ui-space-2) 0 0;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-body-compact);
  line-height: var(--ui-type-leading-normal);
}

.welcome-setup__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-4);
  padding-top: var(--ui-space-5);
}

.welcome-setup__status {
  flex: 1 1 200px;
}

.welcome-setup__status [role="alert"] {
  color: var(--ui-color-danger);
}
</style>
