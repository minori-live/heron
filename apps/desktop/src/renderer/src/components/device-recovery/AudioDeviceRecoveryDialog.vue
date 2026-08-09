<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton, UiDialog, UiSelect, UiStatusNotice } from "@heron/ui"
import type { AudioDeviceRecoverySnapshot } from "@heron/contracts"
import { useAudioDeviceRecoveryDraft } from "./useAudioDeviceRecoveryDraft"

const props = defineProps<{
  recovery: AudioDeviceRecoverySnapshot
  busy: boolean
}>()
const emit = defineEmits<{
  select: [inputDeviceId: string, outputDeviceId: string]
  keep: []
}>()
const { t } = useI18n()
const snapshot = computed(() => props.recovery)
const draft = useAudioDeviceRecoveryDraft(snapshot)
const open = computed({ get: () => true, set: () => {} })
const finalizing = computed(() => props.recovery.phase === "finalizing-recording")
const originalRestored = computed(() => props.recovery.phase === "original-restored")

function submit(): void {
  const preferences = draft.preferences()
  if (preferences) emit("select", preferences.inputDeviceId, preferences.outputDeviceId)
}
</script>

<template>
  <UiDialog
    v-model="open"
    :dismissible="false"
    size="md"
    :eyebrow="t('deviceRecovery.eyebrow')"
    :title="t('deviceRecovery.title')"
    :description="t('deviceRecovery.description')"
  >
    <div class="device-recovery">
      <UiStatusNotice
        v-if="finalizing"
        tone="warning"
        live="assertive"
        :title="t('deviceRecovery.savingTitle')"
      >
        {{ t("deviceRecovery.savingDescription") }}
      </UiStatusNotice>
      <UiStatusNotice
        v-else-if="originalRestored"
        tone="success"
        live="polite"
        :title="t('deviceRecovery.restoredTitle')"
      >
        {{ t("deviceRecovery.restoredDescription") }}
      </UiStatusNotice>
      <UiStatusNotice
        v-else-if="recovery.recordingStatus === 'recoverable'"
        tone="danger"
        live="assertive"
        :title="t('deviceRecovery.recoverableTitle')"
      >
        {{ t("deviceRecovery.recoverableDescription") }}
      </UiStatusNotice>
      <p class="device-recovery__backend">
        {{ t("deviceRecovery.backend", { backend: recovery.previousPreferences.backend }) }}
      </p>
      <label>
        <span>{{ t("deviceRecovery.input") }}</span>
        <UiSelect
          :model-value="draft.inputDeviceId.value"
          :options="draft.inputOptions.value"
          :disabled="busy || finalizing"
          @update:model-value="draft.selectInput"
        />
      </label>
      <label>
        <span>{{ t("deviceRecovery.output") }}</span>
        <UiSelect
          :model-value="draft.outputDeviceId.value"
          :options="draft.outputOptions.value"
          :disabled="busy || finalizing"
          @update:model-value="draft.selectOutput"
        />
      </label>
      <p v-if="recovery.failure" class="device-recovery__error" role="alert">
        {{ t("deviceRecovery.selectionFailed") }}
      </p>
    </div>
    <template #actions>
      <UiButton v-if="originalRestored" :disabled="busy" @click="emit('keep')">
        {{ t("deviceRecovery.keep") }}
      </UiButton>
      <UiButton
        variant="primary"
        :disabled="busy || finalizing || !draft.valid.value"
        :loading="busy"
        @click="submit"
      >
        {{ t("deviceRecovery.useSelected") }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.device-recovery {
  display: grid;
  gap: var(--ui-space-4);
}

.device-recovery label {
  display: grid;
  gap: var(--ui-space-2);
}

.device-recovery__backend {
  margin: 0;
  color: var(--ui-color-text-subtle);
}

.device-recovery__error {
  margin: 0;
  color: var(--ui-color-danger);
}
</style>
