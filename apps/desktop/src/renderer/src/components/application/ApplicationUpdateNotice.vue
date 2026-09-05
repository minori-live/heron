<script setup lang="ts">
import { watch } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton } from "@heron/ui"
import { useApplicationUpdatesStore } from "../../stores/applicationUpdates"
import { useProjectStore } from "../../stores/project"

const { t } = useI18n()
const updates = useApplicationUpdatesStore()
const project = useProjectStore()
watch(
  () => project.desktopSession?.epoch,
  () => {
    void updates.connect()
  },
  { immediate: true }
)
</script>

<template>
  <div
    v-if="updates.snapshot?.phase === 'ready' || updates.snapshot?.phase === 'quarantined'"
    class="flex shrink-0 items-center justify-between gap-3 bg-ui-surface-raised px-3 py-2"
    role="status"
  >
    <span>{{
      updates.error ||
      t(`updates.phases.${updates.snapshot.phase}`, { version: updates.snapshot.availableVersion })
    }}</span>
    <UiButton
      v-if="updates.snapshot.phase === 'ready'"
      size="sm"
      :disabled="updates.busy"
      @click="updates.install()"
      >{{ t("updates.install") }}</UiButton
    >
  </div>
</template>
