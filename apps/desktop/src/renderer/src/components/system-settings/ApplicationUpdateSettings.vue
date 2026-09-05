<script setup lang="ts">
import { onMounted } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton } from "@heron/ui"
import SettingsPage from "../settings/SettingsPage.vue"
import SettingsSection from "../settings/SettingsSection.vue"
import { useApplicationUpdatesStore } from "../../stores/applicationUpdates"

const { t } = useI18n()
const updates = useApplicationUpdatesStore()
onMounted(() => {
  void updates.connect()
})
</script>

<template>
  <SettingsPage
    :category="t('settings.system.categories.system.label')"
    :page="t('updates.title')"
    :title="t('updates.title')"
    :description="t('updates.description')"
  >
    <SettingsSection
      :title="t('updates.version', { version: updates.snapshot?.currentVersion ?? '' })"
      :description="t('updates.policy')"
    >
      <div class="flex flex-col items-start gap-3">
        <p class="m-0 text-ui-xs text-ui-text-muted" role="status">
          {{
            t(`updates.phases.${updates.snapshot?.phase ?? "idle"}`, {
              version: updates.snapshot?.availableVersion ?? "",
              progress: updates.snapshot?.progress ?? 0
            })
          }}
        </p>
        <p v-if="updates.error || updates.snapshot?.error" class="m-0 text-ui-xs" role="alert">
          {{ updates.error || t(`updates.errors.${updates.snapshot?.error}`) }}
        </p>
        <UiButton
          v-if="updates.snapshot && ['idle', 'error', 'available'].includes(updates.snapshot.phase)"
          :disabled="updates.busy"
          @click="updates.command('check')"
          >{{ t("updates.check") }}</UiButton
        >
        <UiButton
          v-if="updates.snapshot?.phase === 'available'"
          :disabled="updates.busy"
          @click="updates.command('download')"
          >{{ t("updates.download") }}</UiButton
        >
        <UiButton
          v-if="updates.snapshot?.phase === 'ready'"
          variant="primary"
          :disabled="updates.busy"
          @click="updates.install()"
          >{{ t("updates.install") }}</UiButton
        >
      </div>
    </SettingsSection>
  </SettingsPage>
</template>
