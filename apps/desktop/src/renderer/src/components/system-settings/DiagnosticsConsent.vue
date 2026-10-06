<script setup lang="ts">
import { UiCheckbox } from "@heron/ui"
import { useI18n } from "vue-i18n"
import SettingsSection from "../settings/SettingsSection.vue"

const props = defineProps<{ modelValue: boolean; disabled?: boolean; stacked?: boolean }>()
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>()
const { t } = useI18n()
</script>

<template>
  <SettingsSection
    :title="t('settings.diagnostics.title')"
    :description="t('settings.diagnostics.description')"
    :layout="props.stacked ? 'stacked' : 'columns'"
  >
    <UiCheckbox
      :model-value="props.modelValue"
      :label="t('settings.diagnostics.label')"
      :description="t('settings.diagnostics.choiceDescription')"
      :disabled="props.disabled"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </SettingsSection>
</template>
